#!/bin/bash

# ============================================================================
# F1 Quantum NexGen - View Container Logs
# ============================================================================

echo "📋 F1 Quantum NexGen - Container Logs"
echo "====================================="
echo ""
echo "Select a service to view logs:"
echo ""
echo "1) All services"
echo "2) Frontend"
echo "3) Backend"
echo "4) Physics Engine"
echo "5) ML Surrogate"
echo "6) Quantum Optimizer"
echo "7) MongoDB"
echo "8) Redis"
echo "9) NATS"
echo ""
read -p "Enter your choice (1-9): " choice

case $choice in
    1)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f
        ;;
    2)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f frontend
        ;;
    3)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f backend
        ;;
    4)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f physics-engine
        ;;
    5)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f ml-surrogate
        ;;
    6)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f quantum-optimizer
        ;;
    7)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f mongodb
        ;;
    8)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f redis
        ;;
    9)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            logs -f nats
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac
