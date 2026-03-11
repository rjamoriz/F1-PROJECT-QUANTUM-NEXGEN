"""
Integration Test: Quantum-Ready Aero Optimization Loop

Tests end-to-end workflow:
1. Generate candidates from design space
2. ML batch predict (cl, cd, balance_proxy, stall_risk)
3. Build QUBO from quadratic surrogate
4. Quantum solve (QAOA)
5. Decode top-k candidates
6. VLM validate top-k
7. Return optimized design

Requirements:
- Backend running on :3001
- ML service on :8000
- Quantum service on :8002
- Physics service on :8001
"""

import pytest
import requests
import time
from typing import Dict, Any


BACKEND_URL = "http://localhost:3001"
TIMEOUT = 180  # 3 minutes for full optimization loop


class TestOptimizationLoop:
    """Integration tests for quantum-ready aero optimization loop"""
    
    @pytest.fixture
    def front_wing_design_space(self) -> Dict[str, Any]:
        """Front wing discrete design space (2026 regs)"""
        return {
            "type": "discrete",
            "component": "front_wing",
            "parameters": {
                "main_aoa_deg": {
                    "values": [2.0, 3.0, 4.0, 5.0, 6.0],
                    "description": "Main element angle of attack [deg]"
                },
                "flap_aoa_deg": {
                    "values": [15.0, 18.0, 21.0, 24.0, 27.0, 30.0],
                    "description": "Flap angle of attack [deg]"
                },
                "gap_mm": {
                    "values": [8.0, 10.0, 12.0, 14.0],
                    "description": "Gap between main & flap [mm]"
                },
                "overlap_pct": {
                    "values": [0.0, 5.0, 10.0, 15.0],
                    "description": "Overlap percentage [%]"
                }
            }
        }
    
    @pytest.fixture
    def flow_conditions(self) -> Dict[str, Any]:
        """Typical F1 flow conditions (mid-speed corner)"""
        return {
            "velocity": 55.0,        # m/s (~200 kph)
            "density": 1.225,        # kg/m³ (sea level)
            "aoa_deg": 0.0,          # Vehicle pitch
            "ground_height": 0.05,   # 50mm ground clearance
            "span": 1.8,             # Front wing span [m]
            "chord": 0.3,            # Reference chord [m]
        }
    
    @pytest.fixture
    def optimization_objectives(self) -> Dict[str, Any]:
        """Multi-objective weights for optimization"""
        return {
            "downforce_weight": 1.0,    # Maximize Cl
            "drag_weight": 0.5,          # Minimize Cd (secondary)
            "balance_weight": 0.3,       # Minimize imbalance
            "stall_weight": 0.3,         # Minimize stall risk
        }
    
    def test_health_check(self):
        """Test optimization service health endpoint"""
        response = requests.get(
            f"{BACKEND_URL}/api/v1/aero/health",
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["service"] == "aero-optimization"
        assert "dependencies" in data
        assert "ml_service" in data["dependencies"]
        assert "quantum_service" in data["dependencies"]
        assert "physics_service" in data["dependencies"]
    
    @pytest.mark.integration
    @pytest.mark.slow
    def test_full_optimization_loop(
        self,
        front_wing_design_space,
        flow_conditions,
        optimization_objectives
    ):
        """Test complete optimization loop with all services"""
        
        request_payload = {
            "design_space": front_wing_design_space,
            "flow_conditions": flow_conditions,
            "objectives": optimization_objectives,
            "constraints": {
                "penalty_weight": 10.0
            },
            "num_candidates": 32,  # Reduced for testing speed
            "candidate_generation_method": "random",
            "top_k": 3,
            "quantum_method": "qaoa",
            "quantum_backend": "aer_simulator",
            "quantum_shots": 512,  # Reduced for testing speed
        }
        
        start_time = time.time()
        
        response = requests.post(
            f"{BACKEND_URL}/api/v1/aero/optimize",
            json=request_payload,
            timeout=TIMEOUT
        )
        
        elapsed = time.time() - start_time
        
        # Assert successful response
        assert response.status_code == 200, f"Got {response.status_code}: {response.text}"
        data = response.json()
        
        # Check response structure
        assert data["success"] is True
        assert "run_id" in data
        assert "result" in data
        assert "metadata" in data
        
        # Check result contains optimized design
        result = data["result"]
        assert "design" in result
        assert "performance" in result
        assert "top_k" in result
        
        # Validate design parameters
        design = result["design"]
        assert "id" in design
        assert "parameters" in design
        params = design["parameters"]
        assert "main_aoa_deg" in params
        assert "flap_aoa_deg" in params
        assert "gap_mm" in params
        assert "overlap_pct" in params
        
        # Validate performance metrics
        perf = result["performance"]
        assert "cl" in perf
        assert "cd" in perf
        assert "cm" in perf
        assert "balance_proxy" in perf
        assert "stall_risk" in perf
        assert "composite_score" in perf
        
        # Check physically reasonable values
        assert 0.0 < perf["cl"] < 10.0, "Cl out of reasonable range"
        assert 0.0 < perf["cd"] < 2.0, "Cd out of reasonable range"
        assert 0.0 <= perf["balance_proxy"] <= 1.0, "Balance proxy out of [0,1]"
        assert 0.0 <= perf["stall_risk"] <= 1.0, "Stall risk out of [0,1]"
        
        # Check top-k selection
        assert len(result["top_k"]) == 3
        
        # Validate metadata
        metadata = data["metadata"]
        assert metadata["total_candidates"] == 32
        assert "quantum_cost" in metadata or "quantum_energy" in metadata  # Accept either field name
        assert "compute_time_ms" in metadata
        assert "timing_breakdown" in metadata
        
        # Check timing breakdown
        timings = metadata["timing_breakdown"]
        assert "candidate_generation_ms" in timings
        assert "ml_inference_ms" in timings
        assert "qubo_construction_ms" in timings
        assert "quantum_solve_ms" in timings
        assert "solution_decoding_ms" in timings
        assert "vlm_validation_ms" in timings
        
        # Performance expectations (full loop should complete in reasonable time)
        total_time_ms = metadata["compute_time_ms"]
        assert total_time_ms < TIMEOUT * 1000, "Optimization took too long"
        
        print(f"\n✓ Optimization completed in {elapsed:.2f}s")
        print(f"  Best design: {design['id']}")
        print(f"  Performance: Cl={perf['cl']:.3f}, Cd={perf['cd']:.3f}, score={perf['composite_score']:.3f}")
        quantum_cost_or_energy = metadata.get('quantum_cost', metadata.get('quantum_energy', 'N/A'))
        print(f"  Quantum cost: {quantum_cost_or_energy if isinstance(quantum_cost_or_energy, str) else f'{quantum_cost_or_energy:.4f}'}")
    
    @pytest.mark.integration
    def test_grid_enumeration(
        self,
        flow_conditions,
        optimization_objectives
    ):
        """Test with smaller design space using grid enumeration"""
        
        small_design_space = {
            "type": "discrete",
            "component": "front_wing",
            "parameters": {
                "main_aoa_deg": {"values": [3.0, 4.0, 5.0]},
                "flap_aoa_deg": {"values": [18.0, 21.0, 24.0]},
            }
        }
        
        request_payload = {
            "design_space": small_design_space,
            "flow_conditions": flow_conditions,
            "objectives": optimization_objectives,
            "num_candidates": 9,  # 3x3 grid
            "candidate_generation_method": "grid",
            "top_k": 2,
            "quantum_method": "qaoa",
            "quantum_backend": "aer_simulator",
            "quantum_shots": 256,
        }
        
        response = requests.post(
            f"{BACKEND_URL}/api/v1/aero/optimize",
            json=request_payload,
            timeout=TIMEOUT
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["metadata"]["total_candidates"] == 9
    
    @pytest.mark.integration
    def test_retrieve_optimization_run(
        self,
        front_wing_design_space,
        flow_conditions,
        optimization_objectives
    ):
        """Test retrieving optimization run by ID"""
        
        # First, run an optimization
        request_payload = {
            "design_space": front_wing_design_space,
            "flow_conditions": flow_conditions,
            "objectives": optimization_objectives,
            "num_candidates": 16,
            "top_k": 1,
            "quantum_method": "qaoa",
        }
        
        opt_response = requests.post(
            f"{BACKEND_URL}/api/v1/aero/optimize",
            json=request_payload,
            timeout=TIMEOUT
        )
        
        assert opt_response.status_code == 200
        run_id = opt_response.json()["run_id"]
        
        # Then, retrieve it
        retrieve_response = requests.get(
            f"{BACKEND_URL}/api/v1/aero/optimize/{run_id}",
            timeout=10
        )
        
        assert retrieve_response.status_code == 200
        data = retrieve_response.json()
        
        assert data["success"] is True
        assert "run" in data
        run = data["run"]
        assert run["runId"] == run_id
        assert "request" in run
        assert "result" in run
        assert "timingBreakdown" in run
    
    @pytest.mark.integration
    def test_recent_optimizations(self):
        """Test retrieving recent optimization runs"""
        
        response = requests.get(
            f"{BACKEND_URL}/api/v1/aero/optimize/recent?limit=5",
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] is True
        assert "runs" in data
        assert "count" in data
        assert data["count"] == len(data["runs"])
        assert data["count"] <= 5
    
    @pytest.mark.integration
    def test_missing_design_space(self, flow_conditions, optimization_objectives):
        """Test validation: missing design_space"""
        
        request_payload = {
            "flow_conditions": flow_conditions,
            "objectives": optimization_objectives,
        }
        
        response = requests.post(
            f"{BACKEND_URL}/api/v1/aero/optimize",
            json=request_payload,
            timeout=10
        )
        
        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Missing required fields" in data["error"]
    
    @pytest.mark.integration
    def test_missing_flow_conditions(
        self,
        front_wing_design_space,
        optimization_objectives
    ):
        """Test validation: missing flow_conditions"""
        
        request_payload = {
            "design_space": front_wing_design_space,
            "objectives": optimization_objectives,
        }
        
        response = requests.post(
            f"{BACKEND_URL}/api/v1/aero/optimize",
            json=request_payload,
            timeout=10
        )
        
        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Missing required fields" in data["error"]


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "-m", "integration"])
