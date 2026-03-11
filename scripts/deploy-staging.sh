#!/bin/bash
# Q-AERO Staging Deployment Script
# Usage: ./scripts/deploy-staging.sh

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Q-AERO Staging Deployment${NC}"
echo -e "${GREEN}========================================${NC}\n"

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

if [ ! -f ".env.staging" ]; then
    echo -e "${RED}❌ .env.staging not found!${NC}"
    echo "   Copy .env.staging.example to .env.staging and fill in secrets."
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found!${NC}"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose not found!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites met${NC}\n"

# Pull latest changes (if in git repo)
if [ -d ".git" ]; then
    echo -e "${YELLOW}📥 Pulling latest code...${NC}"
    if git diff-index --quiet HEAD --; then
        git pull origin develop 2>&1 || echo -e "${YELLOW}⚠️  Could not pull latest (branch may not exist or no remote)${NC}"
    else
        echo -e "${YELLOW}⚠️  Unstaged changes detected, skipping git pull${NC}"
        echo -e "${YELLOW}   Deploying current working directory state${NC}"
    fi
fi

# Stop existing staging containers
echo -e "${YELLOW}🛑 Stopping existing staging containers...${NC}"
docker compose \
    -f docker-compose.yml \
    -f docker-compose.staging.yml \
    --env-file .env.staging \
    down || true

# Build images
echo -e "${YELLOW}🔨 Building images...${NC}"
docker compose \
    -f docker-compose.yml \
    -f docker-compose.staging.yml \
    --env-file .env.staging \
    build --no-cache

# Start services
echo -e "${YELLOW}🚀 Starting staging services...${NC}"
docker compose \
    -f docker-compose.yml \
    -f docker-compose.staging.yml \
    --env-file .env.staging \
    up -d --build

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"
sleep 10

# Health check
echo -e "${YELLOW}🏥 Checking service health...${NC}"
BACKEND_URL="http://localhost:3001"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf "${BACKEND_URL}/api/v1/aero/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Services are healthy!${NC}\n"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "   Attempt ${RETRY_COUNT}/${MAX_RETRIES}..."
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ Health check failed after ${MAX_RETRIES} attempts${NC}"
    echo "   Check logs: docker compose -f docker-compose.yml -f docker-compose.staging.yml logs"
    exit 1
fi

# Run smoke tests
echo -e "${YELLOW}🧪 Running smoke tests...${NC}"
if ! python tests/load_test.py --target staging --duration 30 --users 3; then
    echo -e "${RED}❌ Smoke tests failed!${NC}"
    echo "   Review logs and fix issues before proceeding"
    exit 1
fi

echo -e "${GREEN}✅ Smoke tests passed!${NC}\n"

# Show running services
echo -e "${YELLOW}📊 Running services:${NC}"
docker compose \
    -f docker-compose.yml \
    -f docker-compose.staging.yml \
    ps

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Staging Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nNext steps:"
echo -e "  1. Run load tests: ${YELLOW}python tests/load_test.py --target staging --duration 300 --users 10${NC}"
echo -e "  2. Review metrics and logs"
echo -e "  3. If stable, proceed to production deployment"
echo -e "\nUseful commands:"
echo -e "  View logs: ${YELLOW}docker compose -f docker-compose.yml -f docker-compose.staging.yml logs -f${NC}"
echo -e "  Stop: ${YELLOW}docker compose -f docker-compose.yml -f docker-compose.staging.yml down${NC}"
