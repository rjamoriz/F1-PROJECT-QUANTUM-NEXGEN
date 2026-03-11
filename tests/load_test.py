"""
Q-AERO Load Testing Suite
Tests system performance under concurrent optimization requests
Simulates race weekend load with multiple teams running optimizations

Usage:
    python tests/load_test.py --target staging --duration 60 --users 10
    python tests/load_test.py --target production --duration 300 --users 5 --ramp-up 30
"""

import argparse
import json
import time
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Tuple
import requests
from datetime import datetime

# Test configuration
TARGETS = {
    'local': 'http://localhost:3001',
    'staging': 'http://staging.qaero.local:3001',
    'production': 'https://api.qaero.f1.com'
}

# Optimization payload template
OPTIMIZATION_PAYLOAD = {
    "design_space": {
        "type": "continuous",
        "parameters": {
            "wing_angle": {"min": 3.0, "max": 8.0},
            "ride_height": {"min": 60.0, "max": 90.0},
            "diffuser_angle": {"min": 10.0, "max": 20.0},
            "front_wing_flap": {"min": 15.0, "max": 35.0}
        }
    },
    "flow_conditions": {
        "airspeed_ms": 60.0,
        "altitude_m": 100.0,
        "air_density": 1.225,
        "temperature_c": 20.0
    },
    "objectives": {
        "downforce_weight": 1.0,
        "drag_weight": 0.5,
        "balance_weight": 0.3,
        "stall_weight": 0.3
    },
    "constraints": {
        "penalty_weight": 10.0
    },
    "num_candidates": 16,
    "top_k": 3,
    "quantum_method": "auto",
    "vlm_validation": True
}


class LoadTestResult:
    """Results container for load test metrics"""
    
    def __init__(self):
        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0
        self.response_times = []
        self.errors = []
        self.start_time = None
        self.end_time = None
    
    def add_result(self, success: bool, response_time: float, error: str = None):
        """Record a single request result"""
        self.total_requests += 1
        if success:
            self.successful_requests += 1
            self.response_times.append(response_time)
        else:
            self.failed_requests += 1
            if error:
                self.errors.append(error)
    
    def get_summary(self) -> Dict:
        """Generate summary statistics"""
        duration = (self.end_time - self.start_time) if self.start_time and self.end_time else 0
        
        if self.response_times:
            sorted_times = sorted(self.response_times)
            p50_idx = int(len(sorted_times) * 0.50)
            p95_idx = int(len(sorted_times) * 0.95)
            p99_idx = int(len(sorted_times) * 0.99)
            
            return {
                "total_requests": self.total_requests,
                "successful_requests": self.successful_requests,
                "failed_requests": self.failed_requests,
                "success_rate": (self.successful_requests / self.total_requests * 100) if self.total_requests > 0 else 0,
                "duration_seconds": duration,
                "requests_per_second": self.total_requests / duration if duration > 0 else 0,
                "response_times": {
                    "min_ms": min(self.response_times) * 1000,
                    "max_ms": max(self.response_times) * 1000,
                    "mean_ms": statistics.mean(self.response_times) * 1000,
                    "median_ms": sorted_times[p50_idx] * 1000,
                    "p95_ms": sorted_times[p95_idx] * 1000,
                    "p99_ms": sorted_times[p99_idx] * 1000,
                },
                "errors": self.errors[:10]  # First 10 errors
            }
        else:
            return {
                "total_requests": self.total_requests,
                "successful_requests": 0,
                "failed_requests": self.failed_requests,
                "success_rate": 0,
                "duration_seconds": duration,
                "requests_per_second": 0,
                "errors": self.errors[:10]
            }


def run_single_optimization(base_url: str, request_id: int) -> Tuple[bool, float, str]:
    """
    Run a single optimization request
    
    Returns:
        (success, response_time, error_message)
    """
    start = time.time()
    
    try:
        response = requests.post(
            f"{base_url}/api/v1/aero/optimize",
            json=OPTIMIZATION_PAYLOAD,
            timeout=60
        )
        
        elapsed = time.time() - start
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                return (True, elapsed, None)
            else:
                return (False, elapsed, f"API returned success=false: {data.get('error', 'Unknown')}")
        else:
            return (False, elapsed, f"HTTP {response.status_code}: {response.text[:100]}")
            
    except requests.exceptions.Timeout:
        elapsed = time.time() - start
        return (False, elapsed, "Request timeout (>60s)")
    except Exception as e:
        elapsed = time.time() - start
        return (False, elapsed, str(e))


def run_health_check(base_url: str) -> bool:
    """Verify system health before load test"""
    try:
        response = requests.get(f"{base_url}/health", timeout=10)
        if response.status_code == 200:
            data = response.json()
            # Simple health check - just need 200 OK
            return data.get('status') == 'healthy'
        return False
    except Exception as e:
        print(f"❌ Health check failed: {e}")
        return False


def run_load_test(base_url: str, duration: int, concurrent_users: int, ramp_up: int = 0) -> LoadTestResult:
    """
    Run load test with specified parameters
    
    Args:
        base_url: Target API base URL
        duration: Test duration in seconds
        concurrent_users: Number of concurrent virtual users
        ramp_up: Ramp-up time in seconds (gradual user increase)
    """
    result = LoadTestResult()
    result.start_time = time.time()
    
    print(f"\n🚀 Starting load test:")
    print(f"   Target: {base_url}")
    print(f"   Duration: {duration}s")
    print(f"   Concurrent users: {concurrent_users}")
    print(f"   Ramp-up: {ramp_up}s\n")
    
    # Health check first
    print("🔍 Running health check...")
    if not run_health_check(base_url):
        print("❌ Health check failed! System not ready for load test.")
        result.end_time = time.time()
        return result
    print("✅ Health check passed!\n")
    
    request_id = 0
    with ThreadPoolExecutor(max_workers=concurrent_users) as executor:
        futures = []
        end_time = time.time() + duration
        
        while time.time() < end_time:
            # Ramp-up logic: gradually add users
            elapsed = time.time() - result.start_time
            if ramp_up > 0:
                active_users = min(concurrent_users, int((elapsed / ramp_up) * concurrent_users))
            else:
                active_users = concurrent_users
            
            # Submit requests up to active user count
            while len(futures) < active_users:
                request_id += 1
                future = executor.submit(run_single_optimization, base_url, request_id)
                futures.append(future)
            
            # Check completed requests
            done_futures = [f for f in futures if f.done()]
            for future in done_futures:
                success, response_time, error = future.result()
                result.add_result(success, response_time, error)
                futures.remove(future)
            
            # Progress update
            if result.total_requests % 10 == 0 and result.total_requests > 0:
                print(f"📊 Progress: {result.successful_requests}/{result.total_requests} requests "
                      f"({result.successful_requests/result.total_requests*100:.1f}% success) "
                      f"[{int(time.time() - result.start_time)}s elapsed]")
            
            time.sleep(0.1)  # Prevent tight loop
        
        # Wait for remaining requests
        print("\n⏳ Waiting for remaining requests to complete...")
        for future in as_completed(futures):
            success, response_time, error = future.result()
            result.add_result(success, response_time, error)
    
    result.end_time = time.time()
    return result


def print_results(result: LoadTestResult, target: str):
    """Pretty-print load test results"""
    summary = result.get_summary()
    
    print("\n" + "="*60)
    print(f"  Q-AERO LOAD TEST RESULTS - {target.upper()}")
    print("="*60)
    print(f"\n📈 THROUGHPUT")
    print(f"   Total Requests:      {summary['total_requests']}")
    print(f"   Successful:          {summary['successful_requests']} ({summary['success_rate']:.1f}%)")
    print(f"   Failed:              {summary['failed_requests']}")
    print(f"   Duration:            {summary['duration_seconds']:.1f}s")
    print(f"   Req/second:          {summary['requests_per_second']:.2f}")
    
    if summary.get('response_times'):
        rt = summary['response_times']
        print(f"\n⏱️  RESPONSE TIMES (milliseconds)")
        print(f"   Min:                 {rt['min_ms']:.0f} ms")
        print(f"   Mean:                {rt['mean_ms']:.0f} ms")
        print(f"   Median (p50):        {rt['median_ms']:.0f} ms")
        print(f"   p95:                 {rt['p95_ms']:.0f} ms")
        print(f"   p99:                 {rt['p99_ms']:.0f} ms")
        print(f"   Max:                 {rt['max_ms']:.0f} ms")
    
    if summary.get('errors'):
        print(f"\n❌ ERRORS (first 10)")
        for i, error in enumerate(summary['errors'][:10], 1):
            print(f"   {i}. {error}")
    
    # Pass/Fail assessment
    print(f"\n{'='*60}")
    if summary['success_rate'] >= 95 and rt.get('p95_ms', float('inf')) < 5000:
        print("✅ LOAD TEST PASSED - System ready for production")
    elif summary['success_rate'] >= 90:
        print("⚠️  LOAD TEST WARNING - System functional but below target")
    else:
        print("❌ LOAD TEST FAILED - System not ready for production")
    print("="*60 + "\n")


def save_results(result: LoadTestResult, target: str, filename: str = None):
    """Save test results to JSON file"""
    if not filename:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"load_test_{target}_{timestamp}.json"
    
    summary = result.get_summary()
    summary['target'] = target
    summary['timestamp'] = datetime.now().isoformat()
    
    with open(filename, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"💾 Results saved to: {filename}")


def main():
    parser = argparse.ArgumentParser(description='Q-AERO Load Testing Suite')
    parser.add_argument('--target', choices=['local', 'staging', 'production'], default='local',
                        help='Target environment')
    parser.add_argument('--duration', type=int, default=60,
                        help='Test duration in seconds (default: 60)')
    parser.add_argument('--users', type=int, default=5,
                        help='Concurrent users (default: 5)')
    parser.add_argument('--ramp-up', type=int, default=0,
                        help='Ramp-up time in seconds (default: 0)')
    parser.add_argument('--save', action='store_true',
                        help='Save results to JSON file')
    
    args = parser.parse_args()
    
    base_url = TARGETS[args.target]
    
    # Run load test
    result = run_load_test(base_url, args.duration, args.users, args.ramp_up)
    
    # Print results
    print_results(result, args.target)
    
    # Save if requested
    if args.save:
        save_results(result, args.target)


if __name__ == '__main__':
    main()
