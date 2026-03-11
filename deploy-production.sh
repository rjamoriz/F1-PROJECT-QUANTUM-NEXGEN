#!/bin/bash

# ============================================================================
# F1 Quantum NexGen - Production Deployment Script for Docker Desktop
# ============================================================================

set -e  # Exit on error

echo "🏎️  F1 Quantum NexGen - Production Deployment"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}❌ Error: .env.production file not found!${NC}"
    echo "Please create .env.production from .env.production.example"
    exit 1
fi

echo -e "${GREEN}✅ Environment file found${NC}"
echo ""

# Security check
if grep -q "CHANGE_ME" .env.production; then
    echo -e "${YELLOW}⚠️  WARNING: Your .env.production contains CHANGE_ME placeholders!${NC}"
    echo -e "${YELLOW}   For production, please update JWT_SECRET and other sensitive values.${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "📦 Building and Starting Production Containers..."
echo "================================================="
echo ""

# Stop any running containers first
echo "🛑 Stopping existing containers..."
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    down 2>/dev/null || true

echo ""
echo "🔨 Building containers (this may take several minutes)..."
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    build

echo ""
echo "🚀 Starting containers..."
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

echo ""
echo "📊 Container Status:"
echo "==================="
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    ps

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo "🌐 Access your application:"
echo "   Frontend:  http://localhost:3000"
echo "   Backend:   http://localhost:3001"
echo "   MongoDB:   mongodb://localhost:27017"
echo "   Redis:     redis://localhost:6379"
echo ""
echo "📝 Useful Commands:"
echo "   View logs:     ./view-logs.sh"
echo "   Stop all:      ./stop-production.sh"
echo "   Restart:       ./deploy-production.sh"
echo ""
echo -e "${BLUE}💡 First time setup?${NC}"
echo "   The backend will automatically initialize the database on first run."
echo ""
