#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.yml" -f "${ROOT_DIR}/docker-compose.desktop.yml")
ENV_FILE="${ROOT_DIR}/.env.desktop"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ROOT_DIR}/.env.desktop.example" "${ENV_FILE}"
fi

echo "[validate] rendering Docker Desktop compose config"
docker compose --env-file "${ENV_FILE}" "${COMPOSE_FILES[@]}" config >/dev/null

echo "[validate] Docker Desktop compose config is valid"
