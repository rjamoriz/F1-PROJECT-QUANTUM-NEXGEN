#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.yml" -f "${ROOT_DIR}/docker-compose.desktop.yml")
ENV_FILE="${ROOT_DIR}/.env.desktop"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ROOT_DIR}/.env.desktop.example" "${ENV_FILE}"
fi

if [[ "${1:-}" == "--volumes" ]]; then
  echo "[down] stopping stack and removing named volumes"
  docker compose --env-file "${ENV_FILE}" "${COMPOSE_FILES[@]}" down -v
else
  echo "[down] stopping stack"
  docker compose --env-file "${ENV_FILE}" "${COMPOSE_FILES[@]}" down
fi
