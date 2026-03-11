#!/bin/bash

# ============================================================================
# F1 Quantum NexGen - Quick Container Manager
# ============================================================================

echo "🏎️  F1 Quantum NexGen - Container Manager"
echo "========================================="
echo ""
echo "What would you like to do?"
echo ""
echo "1) 🚀 Deploy/Start all containers"
echo "2) 🛑 Stop all containers"
echo "3) 🔄 Restart all containers"
echo "4) 📊 View container status"
echo "5) 📋 View logs"
echo "6) 🏥 Run health check"
echo "7) 🧹 Clean up (stop + remove volumes)"
echo "8) 🔧 Rebuild and restart specific service"
echo "9) 💾 Backup MongoDB data"
echo "0) Exit"
echo ""
read -p "Enter your choice (0-9): " choice

case $choice in
    1)
        ./deploy-production.sh
        ;;
    2)
        ./stop-production.sh
        ;;
    3)
        echo "🔄 Restarting all containers..."
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            restart
        echo "✅ Restart complete"
        ;;
    4)
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            ps
        ;;
    5)
        ./view-logs.sh
        ;;
    6)
        ./health-check.sh
        ;;
    7)
        echo "⚠️  WARNING: This will DELETE ALL DATA!"
        read -p "Are you sure? (type 'yes' to confirm): " confirm
        if [ "$confirm" = "yes" ]; then
            docker compose --env-file .env.production \
                -f docker-compose.yml \
                -f docker-compose.production.yml \
                --profile production \
                down -v
            echo "✅ Cleanup complete"
        else
            echo "Cancelled"
        fi
        ;;
    8)
        echo ""
        echo "Select service to rebuild:"
        echo "1) Frontend"
        echo "2) Backend"
        echo "3) Physics Engine"
        echo "4) ML Surrogate"
        echo "5) Quantum Optimizer"
        read -p "Enter choice (1-5): " svc_choice
        
        case $svc_choice in
            1) service="frontend" ;;
            2) service="backend" ;;
            3) service="physics-engine" ;;
            4) service="ml-surrogate" ;;
            5) service="quantum-optimizer" ;;
            *) echo "Invalid choice"; exit 1 ;;
        esac
        
        echo "🔨 Rebuilding $service..."
        docker compose --env-file .env.production \
            -f docker-compose.yml \
            -f docker-compose.production.yml \
            --profile production \
            up -d --build --force-recreate $service
        echo "✅ $service rebuilt and restarted"
        ;;
    9)
        backup_file="mongodb-backup-$(date +%Y%m%d-%H%M%S).archive"
        echo "💾 Creating MongoDB backup..."
        docker exec qaero-mongodb mongodump --archive=/data/backup.archive
        docker cp qaero-mongodb:/data/backup.archive "./$backup_file"
        echo "✅ Backup saved to: $backup_file"
        ;;
    0)
        echo "👋 Goodbye!"
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac
