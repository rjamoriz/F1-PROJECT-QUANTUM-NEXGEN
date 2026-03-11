# Production Deployment Checklist
**Date:** February 17, 2026  
**Target:** Q-AERO Quantum-Hybrid Aero Optimization Platform  
**Environment:** Production (Docker Desktop)

---

## 🎯 Pre-Deployment Validation

### Staging Environment ✅
- [x] Staging deployed successfully
- [x] All services healthy (backend, ML, physics, quantum, MongoDB, Redis, NATS)
- [x] Smoke test passed: 100% success, 43ms mean, 70ms p95
- [x] Load test validated: 10 concurrent users, appropriate rate limits
- [x] Integration tests: 6/6 passing
- [x] Performance metrics validated: p95 < 1000ms target achieved

### Code & Configuration ✅
- [x] All Phase 5-8 implementation complete
- [x] Docker Compose syntax fixed (removed obsolete version, replicas)
- [x] Physics engine bug fixed (forward reference)
- [x] Git repository up to date
- [x] Production environment file configured (`.env.production`)

---

## 🔐 Production Configuration

### Rate Limiting (Tuned from staging)
```bash
ENABLE_RATE_LIMIT=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=500  # ~8 req/sec, conservative with headroom
```

**Rationale:**
- Staging validated: 1000 req/60s for 10 concurrent users
- Production: 500 req/60s (~8 req/sec) provides safety margin
- Can scale up based on monitoring (increment by 250-500)

### Service Scaling
```bash
docker compose --scale backend=3 \
               --scale ml-surrogate=2 \
               --scale physics-engine=2 \
               --scale quantum-optimizer=2
```

### Resource Limits (per container)
- Backend: 1 CPU, 1GB RAM
- ML/Physics/Quantum: 2 CPU, 4GB RAM
- MongoDB: 2 CPU, 4GB RAM
- Redis/NATS: 0.5 CPU, 512MB RAM

---

## 🚀 Deployment Steps

### 1. Pre-Flight Checks
```bash
# Verify Docker resources
docker system df
docker stats --no-stream

# Check disk space (need ~20GB free)
df -h

# Verify .env.production exists
cat .env.production | grep RATE_LIMIT
```

### 2. Execute Deployment Script
```bash
cd /Users/Ruben_MACPRO/Desktop/F1\ Project\ NexGen
./scripts/deploy-production.sh
```

**Script will:**
- Request confirmation (2x safety check)
- Backup MongoDB database
- Pull latest code (if git clean)
- Stop existing containers
- Build all images with production config
- Start services with scaling
- Run health checks
- Execute smoke test (30 seconds)
- Auto-rollback on failure

### 3. Post-Deployment Validation
```bash
# Verify all services healthy
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --env-file .env.production \
  ps

# Check rate limit headers
curl -v http://localhost:3001/api/v1/aero/health 2>&1 | grep RateLimit

# Run production smoke test
python3 tests/load_test.py --target local --duration 30 --users 3

# Monitor resource usage
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

---

## 📊 Success Criteria

### Service Health
- [ ] All containers running and healthy
- [ ] Health endpoint returns `{"status":"operational"}`
- [ ] No critical errors in logs

### Performance Targets
- [ ] Response time p95 < 1000ms (target: <500ms based on staging)
- [ ] Success rate ≥ 95%
- [ ] Rate limiting active: `RateLimit-Limit: 500`

### Monitoring
- [ ] APM enabled and reporting
- [ ] Metrics dashboards accessible
- [ ] Log aggregation working
- [ ] Alert rules active

---

## 🔄 Rollback Procedure

If any validation fails:

```bash
# Automatic rollback
# (deploy-production.sh handles this automatically)

# Manual rollback if needed
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --env-file .env.production \
  down

# Restore from backup
mongorestore --host localhost:27017 --db qaero ./backups/qaero_backup_TIMESTAMP
```

---

## 📈 Post-Deployment Monitoring

### First 15 minutes (Critical)
- Watch for error spikes: `docker compose logs -f --tail=100`
- Monitor response times: Run load test every 5 minutes
- Check resource usage: `docker stats`
- Verify rate limiting working: Test with burst requests

### First Hour
- Run full load test (5 minutes, 10 users)
- Review APM dashboards
- Check for memory leaks
- Validate quantum service reliability

### First 24 Hours
- Monitor SLO metrics (99.9% availability target)
- Review error budget consumption
- Analyze traffic patterns
- Adjust rate limits if needed

---

## 🎯 Rate Limit Tuning Guidance

**If rate limiting too strict (legitimate requests blocked):**
```bash
# Increment by 250-500
RATE_LIMIT_MAX_REQUESTS=750  # or 1000

# Restart backend
docker compose restart backend

# Wait 60s for window reset
sleep 60

# Re-test
python3 tests/load_test.py --target local --duration 60 --users 5
```

**If under-loaded (< 50% capacity):**
- Current: 500 req/60s can scale to 1000+ based on hardware
- Monitor CPU/memory before increasing
- Test incrementally in 250-500 request steps

---

## 📝 Notes

### Staging vs Production Differences
- **Scaling:** Staging 2x backend, Production 3x backend
- **Rate Limits:** Staging 1000/60s, Production 500/60s (conservative)
- **Resources:** Production has 2x CPU/RAM for ML/physics services
- **Logging:** Production verbose logging with retention policies
- **Monitoring:** Production has APM tracing enabled

### Known Constraints
- Docker Desktop resource limits (check Settings → Resources)
- Rate limit window persists 60 seconds (wait after config changes)
- MongoDB backup adds ~30s to deployment time
- First image build takes 25-30 minutes (subsequent: 1-2 minutes)

---

## ✅ Deployment Authorization

**Authorized by:** Ruben  
**Staging Results:** Validated ✅  
**Production Config:** Reviewed ✅  
**Risk Assessment:** Low (staged deployment, auto-rollback)

**Ready for Production:** ✅

---

## 🏁 Race Weekend Readiness

This deployment provides:
- **Quantum-hybrid optimization** (VQE + QAOA + SA fallback)
- **ML surrogate acceleration** (balance prediction, stall risk)
- **Real-time CFD** (VLM physics engine)
- **Production-grade resilience** (health checks, auto-restart, rollback)
- **Validated performance** (43ms mean response, 70ms p95 in staging)
- **Secure rate limiting** (500 req/60s with headroom)

**System is GO for race weekend deployment! 🏎️💨**
