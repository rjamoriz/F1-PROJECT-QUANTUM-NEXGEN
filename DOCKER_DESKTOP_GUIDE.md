# 🏎️ F1 Quantum NexGen - Docker Desktop Production Guide

Complete guide to deploy your F1 Quantum Aero application in Docker Desktop for production.

## 📋 Prerequisites

- **Docker Desktop** installed and running (minimum 8GB RAM allocated recommended)
- **Git** (for version control)
- At least **20GB** of free disk space

## 🏗️ Architecture Overview

The application consists of the following containers:

| Service | Port | Description |
|---------|------|-------------|
| **Frontend** | 3000 | React application (Nginx) |
| **Backend** | 3001 | Node.js API Gateway + WebSocket |
| **Physics Engine** | 8001 | Python CFD/aerodynamics service |
| **ML Surrogate** | 8000 | Python ML model service |
| **Quantum Optimizer** | 8002 | Python quantum computing service |
| **MongoDB** | 27017 | Database |
| **Redis** | 6379 | Cache & session store |
| **NATS** | 4222/8222 | Message broker for agents |

## 🚀 Quick Start

### Step 1: Configure Environment Variables

The `.env.production` file has been created for you. **IMPORTANT**: Update the security tokens:

```bash
# Edit .env.production and replace these values:
JWT_SECRET=your-super-secure-jwt-secret-here
REFRESH_TOKEN_PEPPER=your-super-secure-refresh-pepper-here
QUANTUM_RELIABILITY_INGEST_TOKEN=your-secure-ingest-token-here
```

💡 **Quick token generation:**
```bash
# Generate secure random tokens (macOS/Linux):
openssl rand -base64 32
```

### Step 2: Make Scripts Executable

```bash
chmod +x deploy-production.sh
chmod +x stop-production.sh
chmod +x view-logs.sh
```

### Step 3: Deploy

```bash
# Build and start all containers
./deploy-production.sh
```

This script will:
- ✅ Check Docker is running
- ✅ Validate environment configuration
- ✅ Build all container images
- ✅ Start all services
- ✅ Show container status

**First deployment takes 10-15 minutes** depending on your internet speed and machine.

### Step 4: Access the Application

Once deployment completes:

- 🌐 **Frontend**: http://localhost:3000
- 🔌 **Backend API**: http://localhost:3001
- 📊 **NATS Monitoring**: http://localhost:8222

## 📊 Monitoring & Management

### View Logs

```bash
# Interactive log viewer
./view-logs.sh

# Or directly view specific service logs:
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    logs -f backend
```

### Check Container Status

```bash
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    ps
```

### Restart a Service

```bash
# Restart backend only
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    restart backend
```

### Stop All Containers

```bash
./stop-production.sh
```

### Complete Cleanup (⚠️ Deletes all data!)

```bash
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    down -v
```

## 🔧 Troubleshooting

### Container Won't Start

1. Check logs:
   ```bash
   ./view-logs.sh
   ```

2. Verify Docker resources:
   - Docker Desktop → Settings → Resources
   - Recommended: 8GB RAM, 4 CPUs

### Database Connection Issues

```bash
# Check MongoDB is healthy
docker exec -it qaero-mongodb mongosh --eval "db.runCommand('ping')"

# Reset MongoDB (⚠️ deletes data!)
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    stop mongodb
docker volume rm f1-project-nexgen_mongodb_data
./deploy-production.sh
```

### Port Already in Use

```bash
# Find what's using the port (e.g., 3000)
lsof -i :3000

# Kill the process or change ports in .env.production
```

### Rebuild Specific Service

```bash
# Force rebuild and restart
docker compose --env-file .env.production \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    --profile production \
    up -d --build --force-recreate backend
```

### Clear Build Cache

```bash
# If builds are failing, clear Docker cache
docker builder prune -a
```

## 🔐 Security Recommendations

For production deployment:

1. ✅ **Change all default secrets** in `.env.production`
2. ✅ **Use strong passwords** (minimum 32 random characters)
3. ✅ **Enable firewall** rules if exposing to network
4. ✅ **Regular backups** of MongoDB data:
   ```bash
   docker exec qaero-mongodb mongodump --out /data/backup
   ```
5. ✅ **Monitor logs** for suspicious activity

## 📈 Performance Tuning

### Allocate More Resources (Docker Desktop)

1. Open Docker Desktop
2. Settings → Resources
3. Recommended for production:
   - **Memory**: 8-16GB
   - **CPUs**: 4-8
   - **Disk**: 60GB+

### Enable GPU Support (Optional)

For ML Surrogate GPU acceleration:

1. Install [NVIDIA Container Toolkit](https://github.com/NVIDIA/nvidia-docker)
2. Update `docker-compose.production.yml`:
   ```yaml
   ml-surrogate:
     deploy:
       resources:
         reservations:
           devices:
             - driver: nvidia
               count: 1
               capabilities: [gpu]
   ```

## 🔄 Updates & Maintenance

### Update Code and Restart

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
./deploy-production.sh
```

### Backup Data

```bash
# Backup MongoDB
docker exec qaero-mongodb mongodump --archive=/data/backup.archive

# Copy to host
docker cp qaero-mongodb:/data/backup.archive ./backup-$(date +%Y%m%d).archive
```

### Restore Data

```bash
# Copy backup to container
docker cp backup-20260212.archive qaero-mongodb:/data/restore.archive

# Restore
docker exec qaero-mongodb mongorestore --archive=/data/restore.archive
```

## 📞 Support

- 📖 [Main README](./README.MD)
- 📘 [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- 🐛 Issues: Check container logs with `./view-logs.sh`

## 🎯 Next Steps

After deployment:

1. ✅ Access frontend at http://localhost:3000
2. ✅ Test backend health: http://localhost:3001/health
3. ✅ Monitor NATS: http://localhost:8222/
4. ✅ Run integration tests: `npm test` in services/backend
5. ✅ Set up monitoring (Prometheus/Grafana) using `docker-compose.monitoring.yml`

---

**Happy Racing! 🏁**
