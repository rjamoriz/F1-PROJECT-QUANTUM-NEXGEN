#!/bin/bash

# ============================================================================
# F1 Quantum NexGen - Stop Production Containers
# ============================================================================

set -e

echo "🛑 Stopping F1 Quantum NexGen Production Containers..."
echo "======================================================"
echo ""

# Stop containers
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    down

echo ""
echo "✅ All production containers stopped."
echo ""
echo "💡 To completely remove volumes (WARNING: This deletes all data!):"
echo "   docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml --profile production down -v"
echo ""
