# plan.md — UI/UX + Next.js Upgrade Plan for **Quantum-Aero F1 Prototype**
_Last updated: 2026-02-16_

This plan upgrades the app into a **modern “Aero Workstation”**: clear aerodynamic meaning, fast navigation, better realtime + 3D, and a clean design system.

## Goals (what “spectacular + intuitive” means)
### User outcomes
- **Run → Understand → Compare → Decide** in < 60 seconds:
  1) pick component + conditions  
  2) run VLM/CFD/ML/Quantum  
  3) see KPIs + deltas + confidence  
  4) export/share report

### Engineering outcomes
- Migrate to **Next.js + React + TypeScript** (App Router).
- Standardize UI with a single design system (no mixed CSS/MUI).
- Define **aerodynamic data contracts** with units, definitions, and validation.
- Improve visualization fidelity (3D & 2D) and “explainability”.

---

## 1) Quick audit of current repo (what to keep vs fix)
### Keep
- Modular dashboards: generator, quantum, 3D, multiphysics.
- Real-time “simulation + logs” pattern.
- Clear ambition + architecture documented in README / visual guide.

### Fix first (high leverage)
- **Frontend is CRA (`react-scripts`)** → migrate to Next.js.
- **Dependency drift**: components import libraries not in `package.json` (e.g. lucide-react, MUI).
- **Corrupted/emoji icons & incomplete JSX** in multiple components.
- **Huge CSS files**: difficult to maintain, inconsistent style.
- **Aero metrics lack context**: units, sign conventions, baselines, and confidence are not first-class.

---

## 2) Product concept: “Aero Workstation” information architecture
### Primary navigation (left rail)
1. **Workbench** (default)  
   *One place to run solvers and view results + 3D.*
2. **Compare**  
   *Baseline vs candidate; delta everything.*
3. **Optimize**  
   *QAOA / VQE / Annealing / hybrid loops; constraints & Pareto.*
4. **Datasets**  
   *Runs, sweeps, uploads, synthetic generation, IndexedDB cache.*
5. **Reports**  
   *One-click report builder with assumptions + validation level.*
6. **System**  
   *Services status, queues, hardware, config, logs.*

### Workbench layout (recommended)
- **Top bar**: Design ID, component, conditions, solver, validation badge
- **Center**: 3D viewport (pressure/streamlines/vortices)
- **Right panel** (tabs): Metrics / Plots / Inputs / Logs
- **Bottom drawer**: timeline (realtime) or convergence chart (optimization)

---

## 3) Next.js migration blueprint (React + Next.js + Framer Motion)
### Target stack
- **Next.js (App Router)** + **TypeScript**
- **TailwindCSS** + **shadcn/ui** (Radix) for a cohesive UI system
- **Framer Motion** for transitions, panel reveals, animated KPIs
- **TanStack Query** for API caching + retries + background refetch
- **Zustand** for lightweight global state (active run, selected design, viewport layers)
- **Zod** for runtime validation of API responses and dataset files

### Recommended monorepo layout (minimal friction)
```
/apps/web            # Next.js app (new)
/packages/aero-core  # schemas, units, derived-metrics, validators
/packages/ui         # shared UI components (charts wrappers, cards, badges)
/packages/api        # typed API client + WebSocket helpers
/frontend            # (legacy) CRA app — kept during migration then removed
```

### Migration strategy (no big-bang)
1. **Create `/apps/web`** and implement the new layout + navigation.
2. Port screens one by one:
   - Workbench (generator + 3D)
   - Compare
   - Optimize
   - Reports
3. When parity is reached, deprecate `/frontend`.

---

## 4) Design system: make it look premium, consistent, and fast
### Visual identity
- Dark “carbon” base + neon accents (cyan/purple/green) consistent with current theme.
- Typography scale: clear H1/H2, dense but readable tables, mono for numbers.
- Consistent spacing: 4/8/12/16/24 grid.

### UI building blocks (shadcn)
- `Card`, `Tabs`, `Badge`, `Tooltip`, `Popover`, `Sheet`, `Drawer`
- `DataTable` (TanStack Table) with row selection + column pinning
- `Command` palette (⌘K): search runs, navigate screens, execute actions

### Motion guidelines
- Use Framer Motion only where it improves understanding:
  - transitions between tabs
  - “new data arrived” highlight
  - KPI delta “flip” animations
  - 3D layer toggles with subtle fade/scale

---

## 5) Aerodynamic data clarity (definitions + units + derived metrics)
### Create a single source of truth: `AeroResult` schema
**Problem today:** each dashboard invents its own structure; units/meaning are implicit.

**Solution:** define strict contracts in `packages/aero-core`:
- `AeroConditions`
  - `velocity_mps`, `yaw_deg`, `aoa_deg`, `rho_kgm3`, `rideHeight_mm`, `rake_deg`, `reynolds`, `mach`
- `AeroForcesCoeffs`
  - `CL`, `CD`, `CY`, `CM_pitch`, `CM_yaw`, `CM_roll`
- `Fields`
  - `Cp[]`, `velocity[]`, `vorticity[]`, mesh metadata (grid dims, bounds)
- `Quality`
  - `solver` (VLM/CFD/ML/Quantum)
  - `validationLevel` (Surrogate / RANS / LES / WT)
  - `confidence` (0..1)
  - `assumptions[]` (e.g., inviscid, steady, symmetry)
- `Baseline`
  - `baselineId` + delta fields computed automatically

### Always show:
- Units on every numeric field (tooltip + inline where space permits)
- Sign convention (e.g. **positive CL = downforce** if you adopt F1 convention)
- A “what changed?” summary (ΔCL, ΔCD, ΔBalance, ΔL/D)
- Uncertainty band / confidence badge

### Derived metrics module
Add deterministic functions:
- `L_over_D = CL / CD`
- `aeroBalance = CL_front / (CL_front + CL_rear)` (or your chosen definition)
- `efficiency = downforce_N / drag_N` when forces available
- `deltaToBaseline(result, baseline)`
- `sanityChecks()` (range checks + NaN detection + missing fields)

---

## 6) Visualization upgrades (make aero “readable”)
### 6.1 3D viewer (React Three Fiber)
**Current:** basic wing mesh + Cp colors + streamlines.

**Upgrade to a workstation viewer**
- Proper **legend** + scalar range controls (auto, manual, percentile clamp)
- **Clipping plane / slice** view (Cp slice, velocity slice)
- Layer toggles:
  - Cp surface
  - Streamlines (seed controls)
  - Vortex cores (Q-criterion / λ2 if available; otherwise heuristic)
  - Force vectors + balance marker
  - Wake visualization (trail lines)
- Interactions:
  - click-to-probe: show Cp/velocity at point
  - measure chord/span distances
  - screenshot/export view state

**Rendering**
- Use `@react-three/postprocessing` (subtle bloom + SSAO) for premium look
- Use `drei` helpers: `Bounds`, `GizmoHelper`, `Html` labels
- Dynamic import for 3D routes to keep SSR fast.

### 6.2 2D aero plots (clarify trends)
Add standard plots engineers expect:
- **Polars**: `CL vs α`, `CD vs CL`, `CM vs α`
- **Cp chordwise**: upper/lower surface lines
- **Pareto front** for optimization (CD vs CL vs constraints)
- **Convergence**: energy/fitness vs iteration + best-so-far
- **Validation ladder**: badge + plot overlay comparing VLM vs ML vs CFD

Implementation options:
- Keep Recharts for simple charts.
- Add **Plotly** (or Visx) for advanced hover + linked brushing across charts.

---

## 7) Data ingestion + storage (datasets that don’t get lost)
### Dataset pipeline
- Upload JSON/CSV → validate with Zod → normalize → store
- Run metadata:
  - `runId`, `designId`, `solver`, timestamps, git commit hash
  - conditions hash (speed/yaw/ride height)
  - baseline reference

### Storage
- Keep IndexedDB idea, but wrap it with a typed API:
  - `saveRun`, `listRuns`, `getRun(runId)`
  - compression for large arrays
- Add export/import:
  - “Export run bundle” (JSON + optional binary arrays)
  - “Share link” (optional later with server storage)

---

## 8) Realtime + backend integration (clean, observable)
### One API entry point (BFF pattern)
Instead of calling many localhost ports from the browser:
- Next.js **Route Handlers** proxy to services
- Standardize base URL env vars:
  - `NEXT_PUBLIC_API_BASE` (client)
  - server-only service URLs

### WebSockets
- Single WS connection per session
- Message envelope:
  - `type`, `runId`, `timestamp`, `payload`
- UI patterns:
  - toast on critical events
  - log stream with severity filters
  - “stale” indicator when stream stops

### Observability
- A “System” page that shows:
  - service health
  - queue depth
  - last error
  - version/build info

---

## 9) Quantum & safety/validation UX (avoid misleading results)
Quantum results should never look “final” without validation:
- Add **Validation Badge**:
  - `Surrogate`, `VLM`, `RANS`, `LES`, `Wind Tunnel`
- Add **Confidence / Assumptions** panel on every result:
  - solver assumptions
  - parameter ranges
  - known failure modes
- For optimization:
  - show constraint satisfaction explicitly (flutter margin, displacement, mass)
  - require a “Confirm baseline” step before comparing

---

## 10) Code health + consistency pass (must-do before fancy features)
### Fix build integrity
- Resolve dependency mismatches (lucide-react, MUI) by **either**:
  - removing them and using shadcn icons, **or**
  - adding them properly and standardizing usage.
- Remove corrupted characters / enforce UTF‑8 without BOM.
- Add `eslint`, `prettier`, `lint-staged`.

### Refactor targets
- Replace gigantic CSS files with:
  - Tailwind + component styles, or CSS modules per component
- Convert core components to TypeScript:
  - generator, optimizer, viewer, storage

---

## 11) Execution roadmap (epics you can track in GitHub issues)
### Epic A — Next.js foundation
- [ ] Create `/apps/web` with App Router, Tailwind, shadcn/ui, Framer Motion
- [ ] Global layout: left rail + top bar + toasts + command palette
- [ ] API client + env config + proxy routes

### Epic B — Aero data core
- [ ] `AeroResult` Zod schema + unit helpers
- [ ] Baseline/delta engine + sanity checks
- [ ] Result “Explain” panel (definitions, ranges, assumptions)

### Epic C — Workbench v1 (run + view + log)
- [ ] Run wizard (component + conditions + solver)
- [ ] 3D viewer v1 (Cp + legend + toggles)
- [ ] KPIs + key plots (polars + Cp chordwise)

### Epic D — Compare + Reports
- [ ] Baseline selection
- [ ] Side-by-side compare + delta plots + delta Cp map
- [ ] Report builder (export PDF/HTML later; start with Markdown)

### Epic E — Optimize
- [ ] Unified optimization UI (QAOA/VQE/Annealing)
- [ ] Constraint dashboard + Pareto + convergence
- [ ] Validation gate: show “Needs CFD confirmation” explicitly

---

## 12) Definition of Done (what “improved” looks like)
- App boots cleanly, no missing deps, no corrupted icons.
- New Next.js UI: consistent design, responsive, accessible.
- Every aero number has:
  - units + definition
  - delta vs baseline
  - confidence + validation level
- 3D viewer supports:
  - Cp legend + range clamp
  - click probe
  - layer toggles
- Compare view answers: “what changed and why”.

---

## Appendix: immediate fixes spotted in current code
- Standard deviation calculation should compute mean first, then std (currently uses an uninitialized mean in the same object construction).
- Avoid referencing config fields that don’t exist (`maxIterations` vs state).
- `getStatusIcon()` should return actual icons (currently empty returns in some files).
