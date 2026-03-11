#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.yml" -f "${ROOT_DIR}/docker-compose.desktop.yml")
ENV_FILE="${ROOT_DIR}/.env.desktop"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ROOT_DIR}/.env.desktop.example" "${ENV_FILE}"
fi

echo "[status] compose services"
docker compose --env-file "${ENV_FILE}" "${COMPOSE_FILES[@]}" ps

echo
if command -v curl >/dev/null 2>&1; then
  echo "[status] backend /health"
  curl -fsS http://localhost:3001/health || echo "backend health check failed"
  echo
  echo "[status] frontend /"
  curl -fsS http://localhost:3000/ || echo "frontend health check failed"
  echo
else
  echo "[status] curl not found; skipped HTTP health checks"
fi
