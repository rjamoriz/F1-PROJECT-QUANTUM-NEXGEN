# Wind Tunnel + VLM + Quantum Coupling Backlog

Status: In Progress  
Owner: Backend + Frontend integration track  
Scope: Extension track beyond the original 4-phase roadmap

## Objective

Deliver a first production-ready wind tunnel workflow that couples:
- aerodynamic visualization (airflow + vortex lattice nodes)
- VLM node-force analytics
- quantum node-selection optimization
- CFD-proxy corrected metrics

Phase A focuses on contract-stable API + UI integration using the existing backend orchestration path.

## Phase A (Implement Now)

### Components

1. `frontend/src/components/WindTunnelStudio.jsx`
- New UI surface for wind tunnel scenarios.
- Loads scenario/config contract from backend.
- Triggers coupled run contract from backend.
- Renders summary metrics:
  - baseline CL/CD/L/D
  - optimized CL/CD/L/D and deltas
  - node hotspot analytics (top lift/drag nodes)
  - flow-field payload metadata (vectors, streamlines, vortex cores)
- Includes scenario controls (surface preset, velocity, alpha, yaw, coupling toggles).

2. `frontend/src/App.jsx` integration
- Add `Wind Tunnel Lab` tab and mount `WindTunnelStudio`.

### Endpoints

1. `GET /api/simulation/wind-tunnel/config`
- Returns stable contract for:
  - available scenarios/presets
  - default request payload
  - expected response fields for run/session retrieval

2. `POST /api/simulation/wind-tunnel/run`
- Accepts scenario + coupled simulation settings.
- Runs existing coupled pipeline (`runCoupledSimulation`) with selected options.
- Requests flow-field payload from physics service (`/api/v1/flow-field`) with fallback generator.
- Returns wind tunnel run payload combining:
  - scenario metadata
  - tunnel environment metadata
  - flow-field visualization payload
  - coupled simulation metrics/workflow
  - node hotspot analytics and quantum selection summary

3. `GET /api/simulation/wind-tunnel/:sessionId`
- Returns previously generated wind tunnel run payload for UI reload/polling support.

### Services

1. `services/backend/src/services/windTunnelAnalytics.js`
- Pure helper layer to keep route code small and deterministic.
- Responsibilities:
  - scenario preset catalog
  - request normalization and defaults
  - flow-field fallback synthesis
  - hotspot extraction from VLM nodes
  - coupled summary shaping for UI contract stability

## Phase B (After A)

### Graphics/Visualization upgrades
- Add 3D tunnel envelope + car/surface overlays in `WindTunnelStudio`.
- Add streamline animation and Cp glyph overlays driven by backend payload.
- Add camera bookmarks (front wing / floor edge / diffuser / rear wing).

### API additions
- `POST /api/simulation/wind-tunnel/compare`
  - compare baseline vs candidate runs side-by-side.
- `GET /api/simulation/wind-tunnel/history`
  - list recent sessions with KPI deltas.

## Phase C (After B)

### Physics fidelity coupling
- Integrate CFD batch calibration adapters for selected wind tunnel runs.
- Add uncertainty/confidence bands for CL/CD corrections.
- Add surface-segment attribution for drag/lift changes.

### Quantum reliability
- Attach provider reliability metadata to each optimization run.
- Enable rollout-policy gates for quantum execution mode inside wind tunnel runs.

## Phase D (After C)

### Production readiness
- Persist wind tunnel session records in Mongo.
- Add websocket streaming channel for run progress and live flow updates.
- Add SLO alerts for wind tunnel contract latency and failure rates.

## Contract Test Backlog

### Backend (Phase A required)

1. `simulation.windTunnel.contract.test.js`
- `GET /wind-tunnel/config` contract shape.
- `POST /wind-tunnel/run` returns required fields and nested contracts.
- `GET /wind-tunnel/:sessionId` returns stored session contract.
- Flow-field fallback contract when upstream flow endpoint is unavailable.

2. Regression keepers
- Existing `simulation.nodeAnalytics.test.js` must continue passing.

### Frontend (Phase B candidate)

1. `WindTunnelStudio` integration tests
- Loads config, runs simulation, renders metrics and hotspot tables.
- Handles session-not-found and degraded-flow fallback states.

## Acceptance Criteria for Phase A

- New endpoints are implemented and covered by backend contract tests.
- New frontend tab calls backend contracts successfully.
- Existing simulation/node analytics behavior remains backward compatible.
- Payload includes enough structure to drive future 3D rendering without breaking schema.

## Data Contract Inputs for Open/Synthetic Data

- Open-data adapter input slots (Phase B/C):
  - `airfoil_profile_id`
  - `surface_segment`
  - `reference_dataset`
  - `confidence`
- Synthetic fallback always available when open-data records are missing.
