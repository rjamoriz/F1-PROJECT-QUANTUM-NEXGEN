/**
 * Frontend endpoint configuration.
 * Uses env overrides in production and localhost defaults in development.
 */

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

const DEFAULTS = {
  backend: 'http://localhost:3001',
  physics: 'http://localhost:8001',
  ml: 'http://localhost:8000',
  gnn: 'http://localhost:8004',
  vqe: 'http://localhost:8005',
  dwave: 'http://localhost:8006',
  realtimeWs: 'ws://localhost:8010',
};

export const BACKEND_API_BASE = normalizeBaseUrl(
  process.env.REACT_APP_BACKEND_URL || DEFAULTS.backend
);

export const PHYSICS_API_BASE = normalizeBaseUrl(
  process.env.REACT_APP_PHYSICS_URL || DEFAULTS.physics
);

export const ML_API_BASE = normalizeBaseUrl(
  process.env.REACT_APP_ML_URL || DEFAULTS.ml
);

export const GNN_API_BASE = normalizeBaseUrl(
  process.env.REACT_APP_GNN_URL || DEFAULTS.gnn
);

export const VQE_API_BASE = normalizeBaseUrl(
  process.env.REACT_APP_VQE_URL || DEFAULTS.vqe
);

export const DWAVE_API_BASE = normalizeBaseUrl(
  process.env.REACT_APP_DWAVE_URL || DEFAULTS.dwave
);

export const REALTIME_WS_BASE = normalizeBaseUrl(
  process.env.REACT_APP_REALTIME_WS_URL || DEFAULTS.realtimeWs
);

export function withBase(baseUrl, path) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function backendUrl(path) {
  return withBase(BACKEND_API_BASE, path);
}

export function realtimeWsUrl(path) {
  return withBase(REALTIME_WS_BASE, path);
}

export const LOCALHOST_URL_MAP = Object.freeze({
  'http://localhost:3001': BACKEND_API_BASE,
  'http://localhost:8001': PHYSICS_API_BASE,
  'http://localhost:8000': ML_API_BASE,
  'http://localhost:8004': GNN_API_BASE,
  'http://localhost:8005': VQE_API_BASE,
  'http://localhost:8006': DWAVE_API_BASE,
});
