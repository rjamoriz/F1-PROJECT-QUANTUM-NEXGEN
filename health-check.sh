#!/bin/bash

# ============================================================================
# F1 Quantum NexGen - Health Check Script
# ============================================================================

echo "🏥 F1 Quantum NexGen - Health Check"
echo "===================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_service() {
    local service_name=$1
    local url=$2
    
    if curl -f -s "$url" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ $service_name${NC} - OK"
        return 0
    else
        echo -e "${RED}❌ $service_name${NC} - DOWN"
        return 1
    fi
}

check_port() {
    local service_name=$1
    local port=$2
    
    if nc -z localhost $port 2>/dev/null; then
        echo -e "${GREEN}✅ $service_name${NC} - Port $port listening"
        return 0
    else
        echo -e "${RED}❌ $service_name${NC} - Port $port not responding"
        return 1
    fi
}

all_ok=true

echo "📡 Checking HTTP Services..."
echo "----------------------------"
check_service "Frontend" "http://localhost:3000" || all_ok=false
check_service "Backend" "http://localhost:3001/health" || all_ok=false
check_service "Physics Engine" "http://localhost:8001/health" || all_ok=false
check_service "ML Surrogate" "http://localhost:8000/health" || all_ok=false
check_service "Quantum Optimizer" "http://localhost:8002/health" || all_ok=false
check_service "NATS Monitoring" "http://localhost:8222/healthz" || all_ok=false

echo ""
echo "🗄️  Checking Database Services..."
echo "--------------------------------"
check_port "MongoDB" 27017 || all_ok=false
check_port "Redis" 6379 || all_ok=false
check_port "NATS" 4222 || all_ok=false

echo ""
echo "🐳 Docker Container Status..."
echo "----------------------------"
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"

echo ""
if [ "$all_ok" = true ]; then
    echo -e "${GREEN}🎉 All services are healthy!${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  Some services are not responding.${NC}"
    echo "Run './view-logs.sh' to investigate."
    exit 1
fi
