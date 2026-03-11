# Copilot Instructions — Quantum-Aero F1 NexGen

## Architecture Overview

This is a **polyglot microservices platform** for F1 aerodynamic optimization combining AI, quantum computing, and real-time CFD. The system has three layers:

1. **Node.js API Gateway** (`services/backend/`, port 3001) — Express 4 backend that proxies to Python micro-services, manages auth/sessions (MongoDB-backed JWT), WebSocket streaming, and observability. All routes live under `src/routes/` as one-file-per-domain Express routers mounted at `/api/*`.
2. **Python micro-services** — FastAPI apps for ML inference (`ml_service/`, port 8003-8004), quantum optimization (`quantum_service/`, port 8005), and physics simulation (`services/physics-engine/`, port 8001). Each exposes REST endpoints with Pydantic models.
3. **Two frontends** — Legacy React CRA (`frontend/`, port 3000) and new **Next.js 14 App Router** (`frontend-next/`) dark-mode UI. New panel work goes in `frontend-next/components/panels/`.

Inter-service communication: backend → Python services via Axios (`src/utils/serviceClient.js`); agents use NATS pub-sub (`agents/utils/nats_client.py`). Infrastructure: MongoDB, Redis, NATS.

## Key Conventions

### Backend (Node.js)
- **CommonJS** (`require`/`module.exports`) throughout — no ES modules.
- Route files export an `express.Router()`. Pattern: `router.post('/path', async (req, res, next) => { try { … } catch(e) { next(e) } })`.
- **Compatibility routes** include inline fallback generators — if the upstream Python service is down, the route returns synthetic data with `source: 'backend-fallback'`. Preserve this graceful-degradation pattern.
- Service clients created via `createServiceClient(name, baseUrl, timeout)` in `src/utils/serviceClient.js` (Axios wrapper with logging interceptors, retry, and Redis cache-aside).
- Models use **PascalCase** file names (`AuditEvent.js`, `RlPolicyRun.js`); route files use **camelCase** (`physics.js`, `multiFidelity.js`).
- Request tracing via `x-request-id` header (auto-generated UUID). Audit logging via `recordAuditEvent()`.
- Env vars use prefixes: `QUANTUM_*`, `OBS_*`, `SLO_*`, `RL_TRAINING_*`, `AUTH_*`. Feature flags: `REQUIRE_DATABASE`, `ENABLE_RATE_LIMIT`, `EVOLUTION_WS_AUTH_REQUIRED`.

### Python Services
- FastAPI + Pydantic request/response models. Training triggered via `BackgroundTasks`.
- ML models: `ml_service/models/{aero_transformer,gnn_rans,aerogan,diffusion}/` — each has `model.py`, `api.py`, and inference/training modules.
- Quantum: `quantum_service/vqe/` and `quantum_service/dwave/` with solver + API split.

### Frontend
- **Next.js** (`frontend-next/`): App Router with `.jsx`, `@/` import alias, `components/panels/` for domain panels, dark mode hardcoded. Use Framer Motion for animations, Recharts for charts, Lucide for icons.
- **React CRA** (`frontend/`): Flat `src/components/` directory. Tailwind CSS + Three.js for 3D. Legacy — avoid adding new features here.

## Testing

### Backend contract tests (primary CI gate)
```bash
cd services/backend && npm run test:contracts   # Jest + Supertest, runs in CI
```
Contract tests mock the service client (`jest.mock('../../utils/serviceClient')`) and validate **response shape** with `expect.objectContaining()` — not exact values. Tests live in `src/routes/__tests__/{domain}.{aspect}.test.js`.

### WebSocket E2E tests
```bash
ENABLE_WS_E2E_TESTS=true npm run test:ws-e2e
```

### Python integration tests (require running services)
```bash
pytest tests/test_integration.py -v   # hits live service URLs
```
`pytest.ini` configures coverage for `services/` and `scripts/`, markers: `@slow`, `@integration`, `@unit`, `@physics`, `@ml`, `@quantum`.

### CI workflow (`.github/workflows/ci.yml`)
Two jobs: `backend-contracts` (Node 20, `npm run test:contracts`) and `frontend-build` (lint + build the CRA frontend). Both run on push to main/develop and on PRs.

## Docker & Deployment

```bash
# Local full stack
docker compose up --build

# Production (with .env.production)
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.production.yml \
  --profile production up --build -d
```
Required secrets in production: `JWT_SECRET`, `REFRESH_TOKEN_PEPPER`. All services healthchecked, connected via `qaero-network`.

## Common Workflows

| Task | Command |
|---|---|
| Start backend (dev) | `cd services/backend && npm run dev` |
| Start Next.js frontend | `cd frontend-next && npm run dev` |
| Run all backend tests | `cd services/backend && npm test` |
| Quantum calibration pipeline | `npm --prefix services/backend run calibration:quantum:approve-live -- --environment prod` |
| Generate synthetic data | `python data_generation/synthetic_cfd_generator.py` |
| Validate Docker Desktop config | `./scripts/validate_desktop_compose.sh` |

## Adding a New Feature

1. **New API route**: Create `services/backend/src/routes/{domain}.js` with Express Router, add fallback stubs, mount in `app.js`, add contract test in `__tests__/{domain}.{aspect}.test.js`.
2. **New Next.js panel**: Add `frontend-next/components/panels/{name}-panel.jsx`, register in `dashboard-shell.jsx`.
3. **New Python model**: Add under `ml_service/models/{name}/` with `model.py` + `api.py` (FastAPI), wire port in `docker-compose.yml`.
