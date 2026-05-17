#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <wrangler-config-path>" >&2
  exit 1
fi

CONFIG_PATH="$1"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "Missing Wrangler config: ${CONFIG_PATH}" >&2
  exit 1
fi

has_match() {
  local pattern="$1"

  if command -v rg >/dev/null 2>&1; then
    rg -q "${pattern}" "${CONFIG_PATH}"
  else
    grep -Eq "${pattern}" "${CONFIG_PATH}"
  fi
}

require_binding() {
  local section_pattern="$1"
  local binding_pattern="$2"
  local description="$3"

  if ! has_match "^[[:space:]]*${section_pattern}[[:space:]]*$"; then
    echo "Missing ${description} section in ${CONFIG_PATH}" >&2
    exit 1
  fi

  if ! has_match "^[[:space:]]*${binding_pattern}[[:space:]]*$"; then
    echo "Missing ${description} binding in ${CONFIG_PATH}" >&2
    exit 1
  fi
}

require_binding "\\[\\[d1_databases\\]\\]" 'binding = "DB"' "D1"
require_binding "\\[\\[r2_buckets\\]\\]" 'binding = "IMAGES"' "R2"

if ! has_match 'NEXT_PUBLIC_SITE_URL[[:space:]]*=[[:space:]]*"https?://[^"]+"'; then
  echo "Missing NEXT_PUBLIC_SITE_URL in ${CONFIG_PATH}" >&2
  exit 1
fi

if has_match 'NEXT_PUBLIC_SITE_URL[[:space:]]*=[[:space:]]*"https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.com)(:[0-9]+)?/?"'; then
  echo "NEXT_PUBLIC_SITE_URL points to a local or placeholder host in ${CONFIG_PATH}" >&2
  exit 1
fi

echo "==> validated Cloudflare bindings in ${CONFIG_PATH}"
