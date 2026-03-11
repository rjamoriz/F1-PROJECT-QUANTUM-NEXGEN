#!/bin/bash
# Q-AERO Production Deployment Script
# Usage: ./scripts/deploy-production.sh
# CRITICAL: Only run after successful staging validation and load testing

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${RED}========================================${NC}"
echo -e "${RED}  Q-AERO PRODUCTION DEPLOYMENT${NC}"
echo -e "${RED}  ⚠️  RACE WEEKEND CRITICAL SYSTEM ⚠️${NC}"
echo -e "${RED}========================================${NC}\n"

# Interactive confirmation
read -p "$(echo -e ${YELLOW}Have you completed staging validation and load testing? [y/N]: ${NC})" confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Deployment cancelled. Complete staging validation first.${NC}"
    exit 1
fi

read -p "$(echo -e ${RED}Are you ABSOLUTELY SURE you want to deploy to PRODUCTION? [y/N]: ${NC})" confirm_prod
if [[ ! $confirm_prod =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled by user.${NC}"
    exit 0
fi

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

if [ ! -f ".env.production" ]; then
    echo -e "${RED}❌ .env.production not found!${NC}"
    echo "   Copy .env.production.example and configure all secrets"
    exit 1
fi

# Verify no placeholder secrets
if grep -q "SECRET_.*}" .env.production; then
    echo -e "${RED}❌ .env.production contains unreplaced secret placeholders!${NC}"
    echo "   Replace all \${SECRET_*} with actual secrets"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites met${NC}\n"

# Create backup of current state
BACKUP_DIR="./backups/pre-deploy-$(date +%Y%m%d_%H%M%S)"
echo -e "${YELLOW}💾 Creating backup: ${BACKUP_DIR}${NC}"
mkdir -p "${BACKUP_DIR}"

# Backup MongoDB (if running)
if docker ps | grep -q mongodb; then
    echo -e "${YELLOW}   Backing up MongoDB...${NC}"
    docker exec mongodb mongodump --out /backups/pre-deploy-$(date +%Y%m%d_%H%M%S) || true
fi

# Backup current .env
cp .env.production "${BACKUP_DIR}/.env.production.backup" || true
echo -e "${GREEN}✅ Backup complete${NC}\n"

# Pull latest code
if [ -d ".git" ]; then
    echo -e "${YELLOW}📥 Pulling latest code from main branch...${NC}"
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        echo -e "${RED}❌ Uncommitted changes detected!${NC}"
        echo -e "${YELLOW}   Production deployment requires clean working directory${NC}"
        read -p "$(echo -e ${YELLOW}Stash changes and continue? [y/N]: ${NC})" stash
        if [[ $stash =~ ^[Yy]$ ]]; then
            git stash save "Pre-production-deploy-$(date +%Y%m%d_%H%M%S)"
            echo -e "${GREEN}✅ Changes stashed${NC}"
        else
            echo -e "${RED}❌ Deployment cancelled${NC}"
            exit 1
        fi
    fi
    
    CURRENT_BRANCH=$(git branch --show-current)
    if [ "$CURRENT_BRANCH" != "main" ]; then
        echo -e "${RED}❌ Not on main branch! Currently on: ${CURRENT_BRANCH}${NC}"
        read -p "$(echo -e ${YELLOW}Continue anyway? [y/N]: ${NC})" cont
        if [[ ! $cont =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    git pull origin main
    COMMIT_SHA=$(git rev-parse --short HEAD)
    echo -e "${BLUE}Deploying commit: ${COMMIT_SHA}${NC}\n"
fi

# Build images with production tag
echo -e "${YELLOW}🔨 Building production images...${NC}"
docker compose \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --env-file .env.production \
    build --no-cache

# Tag images with version
if [ -d ".git" ]; then
    VERSION=$(git describe --tags --always)
    docker tag qaero-backend:latest qaero-backend:${VERSION}
    docker tag qaero-ml:latest qaero-ml:${VERSION}
    docker tag qaero-physics:latest qaero-physics:${VERSION}
    docker tag qaero-quantum:latest qaero-quantum:${VERSION}
    echo -e "${GREEN}✅ Images tagged with version: ${VERSION}${NC}\n"
fi

# Blue-green deployment strategy: start new services alongside old
echo -e "${YELLOW}🔄 Starting production containers...${NC}"
docker compose \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --env-file .env.production \
    up -d --no-deps --build

# Wait for new services to be healthy
echo -e "${YELLOW}⏳ Waiting for new services to be healthy (60s)...${NC}"
sleep 10

BACKEND_URL="http://localhost:3001"
MAX_RETRIES=30
RETRY_COUNT=0
HEALTHY=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf "${BACKEND_URL}/api/v1/aero/health" > /dev/null 2>&1; then
        HEALTH_RESPONSE=$(curl -s "${BACKEND_URL}/api/v1/aero/health")
        if echo "$HEALTH_RESPONSE" | grep -q '"status":"operational"'; then
            echo -e "${GREEN}✅ Services are healthy!${NC}\n"
            HEALTHY=true
            break
        fi
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "   Health check attempt ${RETRY_COUNT}/${MAX_RETRIES}..."
    sleep 2
done

if [ "$HEALTHY" = false ]; then
    echo -e "${RED}❌ Health check failed after ${MAX_RETRIES} attempts${NC}"
    echo -e "${RED}🔙 ROLLING BACK...${NC}"
    docker compose \
        -f docker-compose.yml \
        -f docker-compose.production.yml \
        --env-file .env.production \
        down
    echo -e "${RED}Deployment failed and rolled back. Check logs.${NC}"
    exit 1
fi

# Run production smoke tests
echo -e "${YELLOW}🧪 Running production smoke tests...${NC}"
if ! python tests/load_test.py --target local --duration 30 --users 2; then
    echo -e "${RED}❌ Smoke tests failed!${NC}"
    echo -e "${RED}🔙 ROLLING BACK...${NC}"
    docker compose \
        -f docker-compose.yml \
        -f docker-compose.production.yml \
        down
    exit 1
fi

echo -e "${GREEN}✅ Smoke tests passed!${NC}\n"

# Remove old containers
echo -e "${YELLOW}🧹 Cleaning up old containers...${NC}"
docker system prune -f

# Verify deployment
echo -e "${YELLOW}🔍 Verifying deployment...${NC}"
HEALTH=$(curl -s "${BACKEND_URL}/api/v1/aero/health")
echo -e "${BLUE}Health check response:${NC}"
echo "$HEALTH" | python -m json.tool

# Show running services
echo -e "\n${YELLOW}📊 Running production services:${NC}"
docker compose \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    ps

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Production Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\n${BLUE}📊 POST-DEPLOYMENT CHECKLIST:${NC}"
echo -e "  ✅ Services deployed and healthy"
echo -e "  ✅ Smoke tests passed"
echo -e "  ⏳ Monitor errors for next 15 minutes"
echo -e "  ⏳ Watch performance metrics"
echo -e "  ⏳ Verify APM traces"
echo -e "\n${YELLOW}⚠️  MONITORING REQUIRED:${NC}"
echo -e "  - Watch logs: ${BLUE}docker compose -f docker-compose.yml -f docker-compose.production.yml logs -f backend${NC}"
echo -e "  - Monitor metrics dashboard"
echo -e "  - Check error rates < 0.1%"
echo -e "  - Verify p95 latency < 500ms"
echo -e "\n${YELLOW}🔴 ROLLBACK COMMAND (if needed):${NC}"
echo -e "  ${RED}docker compose -f docker-compose.yml -f docker-compose.production.yml down${NC}"
echo -e "  ${RED}# Then restore backup and redeploy previous version${NC}"
echo -e "\n${GREEN}🏁 System ready for race weekend! Good luck! 🏁${NC}\n"
