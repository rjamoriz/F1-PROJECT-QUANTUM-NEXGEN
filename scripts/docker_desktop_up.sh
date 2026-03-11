#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.yml" -f "${ROOT_DIR}/docker-compose.desktop.yml")
ENV_FILE="${ROOT_DIR}/.env.desktop"

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] Docker CLI not found. Install Docker Desktop first."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[error] Docker daemon is not reachable. Start Docker Desktop and retry."
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[setup] creating .env.desktop from .env.desktop.example"
  cp "${ROOT_DIR}/.env.desktop.example" "${ENV_FILE}"
fi

echo "[up] validating compose config"
docker compose --env-file "${ENV_FILE}" "${COMPOSE_FILES[@]}" config >/dev/null

echo "[up] building and starting Docker Desktop stack"
docker compose --env-file "${ENV_FILE}" "${COMPOSE_FILES[@]}" up --build -d

echo "[up] stack started"
echo "[up] frontend-next: http://localhost:3000"
echo "[up] backend:  http://localhost:3001/health"
