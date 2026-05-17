#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_PATH="$(bash "${SCRIPT_DIR}/cf-config.sh")"

cd "${REPO_ROOT}"

echo "==> using wrangler config: ${CONFIG_PATH}"
bash "${SCRIPT_DIR}/cf-validate-config.sh" "${CONFIG_PATH}"

has_database_id() {
  if command -v rg >/dev/null 2>&1; then
    rg -q '^[[:space:]]*database_id[[:space:]]*=' "${CONFIG_PATH}"
  else
    grep -Eq '^[[:space:]]*database_id[[:space:]]*=' "${CONFIG_PATH}"
  fi
}

rm -rf .next .open-next
npx opennextjs-cloudflare build

npx opennextjs-cloudflare deploy -c "${CONFIG_PATH}"

if has_database_id; then
  echo "==> applying D1 schema"
  npx wrangler d1 execute DB \
    --remote \
    --file="${REPO_ROOT}/db/schema.sql" \
    -c "${CONFIG_PATH}"

  if [[ -f "${REPO_ROOT}/db/seed-template.sql" ]]; then
    echo "==> applying template defaults"
    npx wrangler d1 execute DB \
      --remote \
      --file="${REPO_ROOT}/db/seed-template.sql" \
      -c "${CONFIG_PATH}"
  fi
else
  echo "==> skipping remote D1 schema sync because ${CONFIG_PATH} has no database_id"
  echo "==> runtime schema initialization will create tables and defaults on first request"
fi
