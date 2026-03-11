#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.yml" -f "${ROOT_DIR}/docker-compose.production.yml")

export JWT_SECRET="${JWT_SECRET:-compose-validation-secret}"
export REFRESH_TOKEN_PEPPER="${REFRESH_TOKEN_PEPPER:-compose-validation-pepper}"

echo "[validate] rendering production compose config"
docker compose "${COMPOSE_FILES[@]}" --profile production config >/dev/null

echo "[validate] compose config is valid"
