# Q-AERO Deployment Guide
## Race Weekend Production Deployment Pipeline

This guide covers the complete deployment pipeline from staging to production for the Q-AERO quantum-hybrid aerodynamic optimization system.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Environment Configuration](#environment-configuration)
4. [Staging Deployment](#staging-deployment)
5. [Load Testing](#load-testing)
6. [Production Deployment](#production-deployment)
7. [Monitoring & Rollback](#monitoring--rollback)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### Deployment Pipeline

```
Development → Staging → Load Testing → Production
     ↓            ↓           ↓              ↓
  Local tests  Smoke tests  Stress tests  Validation
```

### Architecture

- **Backend**: Node.js Express (port 3001), 3 replicas in production
- **ML Service**: Python FastAPI (port 8000), 2 replicas
- **Physics Engine**: Python FastAPI (port 8001), 2 replicas
- **Quantum Optimizer**: Python + Qiskit (port 8002), 2 replicas
- **Data Layer**: MongoDB, Redis, NATS

### Performance Targets

| Metric | Staging | Production |
|--------|---------|------------|
| Availability | 99.5% | 99.9% |
| p95 Latency | < 1000ms | < 500ms |
| Error Rate | < 1% | < 0.1% |
| Throughput | 100 req/min | 200 req/min |

---

## Prerequisites

### System Requirements

- Docker 24+ with Compose v2
- Python 3.11+ (for load tests)
- Git (for version tracking)
- 16GB RAM minimum (32GB recommended for production)
- 100GB disk space

### Access Requirements

- Git repository access
- Docker Hub or private registry credentials
- Production secrets (JWT, MongoDB, Redis, NATS)
- (Optional) Kubernetes cluster for true production

### Install Dependencies

```bash
# Python dependencies for load testing
pip install requests

# Verify Docker
docker --version
docker compose version
```

---

## Environment Configuration

### 1. Staging Environment

```bash
# Copy template
cp .env.staging.example .env.staging

# Edit and configure
nano .env.staging
```

**Key Settings for Staging:**

```bash
NODE_ENV=staging
MONGODB_URI=mongodb://mongodb:27017/qaero_staging
REDIS_URL=redis://redis:6379/1
ENABLE_RATE_LIMIT=true
SLO_TARGET_AVAILABILITY=99.5
LOG_LEVEL=info
```

### 2. Production Environment

```bash
# Copy template
cp .env.production.example .env.production

# Replace ALL ${SECRET_*} placeholders
nano .env.production
```

**Critical Production Secrets:**

```bash
JWT_SECRET=<generate-strong-secret-64-chars>
REFRESH_TOKEN_PEPPER=<generate-strong-secret-64-chars>
MONGODB_URI=<mongodb-connection-string>
REDIS_PASSWORD=<redis-auth-password>
NATS_USER=<nats-username>
NATS_PASS=<nats-password>
```

**Generate Strong Secrets:**

```bash
# Generate JWT secret
openssl rand -base64 48

# Generate refresh token pepper
openssl rand -base64 48
```

**Verify Configuration:**

```bash
# Check no placeholders remain
grep -n "\${SECRET_" .env.production
# Should return no results!
```

---

## Staging Deployment

### Automated Deployment

```bash
./scripts/deploy-staging.sh
```

This script will:
1. ✅ Verify prerequisites (.env.staging, Docker)
2. 🛑 Stop existing staging containers
3. 🔨 Build images from scratch
4. 🚀 Start services
5. 🏥 Wait for health checks (30 retries)
6. 🧪 Run smoke tests (30s, 3 users)

### Manual Deployment

If you need more control:

```bash
# Stop existing
docker compose \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  --env-file .env.staging \
  down

# Build
docker compose \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  --env-file .env.staging \
  build --no-cache

# Start
docker compose \
  -f docker-compose.yml \
  -f docker-compose.staging.yml \
  --env-file .env.staging \
  up -d

# Verify
curl http://localhost:3001/api/v1/aero/health
```

### Verify Staging

```bash
# Check all services running
docker compose -f docker-compose.yml -f docker-compose.staging.yml ps

# Check logs
docker compose -f docker-compose.yml -f docker-compose.staging.yml logs backend

# Test optimization endpoint
curl -X POST http://localhost:3001/api/v1/aero/optimize \
  -H "Content-Type: application/json" \
  -d @tests/fixtures/optimization_request.json
```

---

## Load Testing

### Quick Test (Development)

```bash
python tests/load_test.py --target local --duration 60 --users 5
```

### Staging Load Test

```bash
# Standard load test (5 minutes, 10 concurrent users)
python tests/load_test.py \
  --target staging \
  --duration 300 \
  --users 10 \
  --save

# Stress test (10 minutes, 20 concurrent users)
python tests/load_test.py \
  --target staging \
  --duration 600 \
  --users 20 \
  --ramp-up 60 \
  --save
```

### Load Test Targets

| Test Type | Duration | Users | Expected p95 | Expected Success Rate |
|-----------|----------|-------|--------------|---------------------|
| Smoke | 30s | 2-3 | < 2000ms | > 90% |
| Standard | 5min | 10 | < 1000ms | > 95% |
| Stress | 10min | 20 | < 2000ms | > 90% |

### Interpreting Results

Load test output includes:

```
📈 THROUGHPUT
   Total Requests:      150
   Successful:          147 (98.0%)
   Failed:              3
   Req/second:          0.50

⏱️  RESPONSE TIMES (milliseconds)
   Mean:                450 ms
   Median (p50):        420 ms
   p95:                 850 ms
   p99:                 1100 ms
```

**Pass Criteria:**
- ✅ Success rate ≥ 95%
- ✅ p95 latency < 1000ms (staging) or < 500ms (production)
- ✅ No critical errors in logs

**If Load Test Fails:**
1. Review logs: `docker compose logs backend`
2. Check resource usage: `docker stats`
3. Verify service health endpoints
4. Scale up resources if needed
5. Fix issues and re-test before production

---

## Production Deployment

### ⚠️ PRE-DEPLOYMENT CHECKLIST

- [ ] Staging deployed and stable for 24+ hours
- [ ] Load tests passed (success rate ≥ 95%, p95 < 1000ms)
- [ ] All `.env.production` secrets configured (no `${SECRET_*}` placeholders)
- [ ] MongoDB backups verified
- [ ] Rollback plan prepared
- [ ] Team notified and on-call
- [ ] Monitoring dashboards open and ready

### Automated Production Deployment

```bash
./scripts/deploy-production.sh
```

**Interactive Safety Checks:**
- Confirms staging validation complete
- Confirms production deployment intent
- Verifies no placeholder secrets
- Creates automatic backup
- Implements blue-green deployment
- Runs smoke tests
- Auto-rollback on failure

**Script Workflow:**

1. ✅ Interactive confirmation
2. 🔍 Prerequisites check
3. 💾 Backup current state (MongoDB + config)
4. 📥 Pull latest from `main` branch
5. 🔨 Build production images
6. 🏷️ Tag with version (git SHA)
7. 🔄 Blue-green deployment (new + old running)
8. ⏳ Health checks (30 retries, 60s)
9. 🧪 Production smoke tests
10. ✅ Remove old containers
11. 📊 Verify deployment

### Manual Production Deployment

For advanced users or troubleshooting:

```bash
# 1. Backup
BACKUP_DIR="backups/pre-deploy-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
docker exec mongodb mongodump --out "/backups/$BACKUP_DIR"

# 2. Build
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --env-file .env.production \
  build

# 3. Deploy (blue-green)
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --env-file .env.production \
  up -d --scale backend=3

# 4. Health check
curl https://api.qaero.f1.com/api/v1/aero/health

# 5. Smoke test
python tests/load_test.py --target production --duration 30 --users 2
```

### Post-Deployment Validation

```bash
# Verify services
docker compose -f docker-compose.yml -f docker-compose.production.yml ps

# Check logs for errors
docker compose -f docker-compose.yml -f docker-compose.production.yml logs --tail=100 backend

# Test optimization
curl -X POST https://api.qaero.f1.com/api/v1/aero/optimize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{...}'

# Monitor for 15 minutes
watch -n 10 'curl -s https://api.qaero.f1.com/api/v1/aero/health | jq'
```

---

## Monitoring & Rollback

### Real-Time Monitoring

**Health Endpoint:**
```bash
# Check every 10 seconds
watch -n 10 'curl -s http://localhost:3001/api/v1/aero/health | jq'
```

**Expected Healthy Response:**
```json
{
  "status": "operational",
  "dependencies": {
    "ml_service": "healthy",
    "quantum_service": "healthy",
    "physics_service": "healthy"
  }
}
```

**Container Logs:**
```bash
# Follow backend logs
docker compose -f docker-compose.yml -f docker-compose.production.yml logs -f backend

# All services
docker compose -f docker-compose.yml -f docker-compose.production.yml logs -f

# Specific service with timestamps
docker compose logs -f --timestamps ml-surrogate
```

**Resource Usage:**
```bash
# Live stats
docker stats

# Per-service CPU/memory
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

### Key Metrics to Watch

| Metric | Command | Target | Alert If |
|--------|---------|--------|----------|
| HTTP 2xx rate | `curl /health` | > 99.5% | < 99% |
| Response time p95 | Load test | < 500ms | > 1000ms |
| Container restarts | `docker ps` | 0 | > 0 |
| Memory usage | `docker stats` | < 80% | > 90% |
| Error logs | `docker logs` | 0 errors | Any CRITICAL |

### Rollback Procedures

**Option 1: Automated Rollback (recommended)**

```bash
# Stop production
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  down

# Restore previous version
docker images | grep qaero
docker tag qaero-backend:v1.2.3 qaero-backend:latest
docker tag qaero-ml:v1.2.3 qaero-ml:latest
# ... repeat for all services

# Redeploy
./scripts/deploy-production.sh
```

**Option 2: Manual Rollback**

```bash
# 1. Stop current deployment
docker compose -f docker-compose.yml -f docker-compose.production.yml down

# 2. Restore MongoDB backup
BACKUP_DIR="backups/pre-deploy-20240115_143000"
docker exec mongodb mongorestore "/backups/$BACKUP_DIR"

# 3. Checkout previous git version
git log --oneline  # Find previous commit
git checkout <previous-commit-sha>

# 4. Rebuild and deploy
docker compose -f docker-compose.yml -f docker-compose.production.yml build
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d

# 5. Verify
curl http://localhost:3001/api/v1/aero/health
```

**Option 3: Emergency Stop**

```bash
# Nuclear option: stop everything
docker compose -f docker-compose.yml -f docker-compose.production.yml down

# Then investigate offline
```

---

## Troubleshooting

### Common Issues

#### 1. Services Not Starting

**Symptom:** Containers exit immediately or restart loop

**Diagnosis:**
```bash
docker compose logs backend
docker compose ps
```

**Solutions:**
- Check `.env.production` secrets configured correctly
- Verify MongoDB/Redis are healthy before backend starts
- Check port conflicts: `lsof -i :3001`
- Increase memory limits in `docker-compose.production.yml`

#### 2. Health Checks Failing

**Symptom:** `/health` endpoint returns 5xx or times out

**Diagnosis:**
```bash
curl -v http://localhost:3001/api/v1/aero/health
docker logs backend | grep ERROR
```

**Solutions:**
- Verify dependent services (ML, Physics, Quantum) are running
- Check service URLs in `.env` match container names
- Restart services: `docker compose restart backend`
- Check network: `docker network inspect qaero-production-network`

#### 3. High Latency

**Symptom:** p95 > 1000ms in load tests

**Diagnosis:**
```bash
docker stats
docker logs backend | grep "took.*ms"
```

**Solutions:**
- Scale up replicas: `docker compose up -d --scale backend=5`
- Increase resource limits in docker-compose
- Enable Redis caching (check `REQUIRE_REDIS=true`)
- Optimize quantum fallback threshold (reduce `QUANTUM_MAX_QUBITS`)

#### 4. High Error Rate

**Symptom:** Success rate < 95%

**Diagnosis:**
```bash
docker logs backend | grep -i error | tail -50
curl http://localhost:3001/api/v1/aero/optimize/recent | jq
```

**Solutions:**
- Check ML model loading errors
- Verify quantum service fallback logic
- Review QUBO generation errors
- Increase timeouts: `QUANTUM_TIMEOUT_MS=60000`

#### 5. Database Connection Issues

**Symptom:** `MongoNetworkError` or `ECONNREFUSED`

**Diagnosis:**
```bash
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"
docker logs mongodb
```

**Solutions:**
- Wait for MongoDB to initialize (can take 30s)
- Check MongoDB auth: `MONGODB_URI` includes credentials
- Verify network: `docker network ls`
- Restart MongoDB: `docker compose restart mongodb`

#### 6. Load Test Never Completes

**Symptom:** Python script hangs at "Waiting for requests"

**Diagnosis:**
```bash
# Check if backend is actually running
curl http://localhost:3001/api/v1/aero/health

# Check load test target
python tests/load_test.py --target local --duration 10 --users 1
```

**Solutions:**
- Verify correct target URL in `tests/load_test.py`
- Check firewall/network allows connections
- Try shorter duration first to isolate issue
- Increase timeout in script (currently 60s per request)

---

## Advanced Topics

### Kubernetes Deployment

For true production at scale, deploy to Kubernetes:

```bash
# Create namespace
kubectl create namespace qaero

# Apply secrets
kubectl create secret generic qaero-secrets \
  --from-env-file=.env.production \
  -n qaero

# Deploy
kubectl apply -f k8s/ -n qaero

# Verify
kubectl get pods -n qaero
kubectl logs -f deployment/backend -n qaero
```

(K8s manifests not included; adapt docker-compose configs)

### Continuous Deployment (CI/CD)

Example GitHub Actions workflow:

```yaml
name: Deploy to Production
on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: npm test
      - name: Deploy to production
        run: ./scripts/deploy-production.sh
        env:
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
          # ... other secrets
```

### Multi-Region Deployment

For global F1 races, deploy regional instances:

```bash
# EU region
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  -f docker-compose.eu.yml up -d

# US region
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  -f docker-compose.us.yml up -d

# Asia region
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  -f docker-compose.asia.yml up -d
```

---

## Summary Checklist

### Before Race Weekend

- [ ] Staging deployed and stable (72+ hours)
- [ ] Load tests completed (standard + stress)
- [ ] Production secrets configured
- [ ] Backups automated and verified
- [ ] Monitoring dashboards configured
- [ ] On-call team briefed
- [ ] Rollback procedure tested

### During Race Weekend

- [ ] Monitor metrics every 15 minutes
- [ ] Check error logs hourly
- [ ] Verify p95 latency < 500ms
- [ ] Confirm 99.9% success rate
- [ ] Keep rollback ready
- [ ] Document any incidents

### After Race Weekend

- [ ] Export performance metrics
- [ ] Review error logs
- [ ] Document lessons learned
- [ ] Update runbooks
- [ ] Plan optimization improvements

---

## Support & Contacts

- **System Issues**: Check `docker logs` first
- **Performance**: Run load tests and check resource usage
- **Rollback**: Follow procedures in Monitoring section
- **Emergency**: Stop services, investigate offline, rollback

**Good luck with race weekend deployment! 🏁**
