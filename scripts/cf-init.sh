#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_PATH="${REPO_ROOT}/wrangler.toml"
LOCAL_CONFIG_PATH="${REPO_ROOT}/wrangler.local.toml"
DB_NAME="${CF_D1_NAME:-qiaomu-blog-db}"
R2_NAME="${CF_R2_NAME:-qiaomu-blog-images}"
KV_NAME="${CF_KV_NAME:-qiaomu-blog-cache}"
SITE_URL="${SITE_URL:-${NEXT_PUBLIC_SITE_URL:-https://your-domain.com}}"
SEED_TEMPLATE_PATH="${REPO_ROOT}/db/seed-template.sql"
WITH_KV=0

for arg in "$@"; do
  case "$arg" in
    --with-kv)
      WITH_KV=1
      ;;
    --site-url=*)
      SITE_URL="${arg#*=}"
      ;;
    --db-name=*)
      DB_NAME="${arg#*=}"
      ;;
    --r2-name=*)
      R2_NAME="${arg#*=}"
      ;;
    --kv-name=*)
      KV_NAME="${arg#*=}"
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      echo "Usage: npm run cf:init -- [--with-kv] [--site-url=https://your-domain.com] [--db-name=qiaomu-blog-db] [--r2-name=qiaomu-blog-images] [--kv-name=qiaomu-blog-cache]" >&2
      exit 1
      ;;
  esac
done

has_match() {
  local pattern="$1"
  local file="$2"

  if command -v rg >/dev/null 2>&1; then
    rg -q "${pattern}" "${file}"
  else
    grep -Eq "${pattern}" "${file}"
  fi
}

section_has_key() {
  local section="$1"
  local key="$2"
  local file="$3"

  awk -v section="${section}" -v key="${key}" '
    $0 == "[[" section "]]" { in_section = 1; next }
    /^\[\[/ && $0 != "[[" section "]]" { in_section = 0 }
    in_section && $1 == key {
      gsub(/"/, "", $3)
      if ($3 != "") {
        found = 1
        exit
      }
    }
    END {
      if (found == 1) exit 0
      exit 1
    }
  ' "${file}"
}

strip_array_section() {
  local section="$1"
  local file="$2"
  local tmp_file

  tmp_file="$(mktemp)"

  awk -v section="${section}" '
    $0 == "[[" section "]]" {
      skip = 1
      next
    }
    skip && /^\[\[/ {
      skip = 0
    }
    !skip {
      print
    }
  ' "${file}" > "${tmp_file}"

  mv "${tmp_file}" "${file}"
}

cd "${REPO_ROOT}"

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "Cloudflare login required. Run: npx wrangler login" >&2
  exit 1
fi

if [[ ! -f "${LOCAL_CONFIG_PATH}" ]]; then
  cp "${TEMPLATE_PATH}" "${LOCAL_CONFIG_PATH}"
  echo "==> created local config: ${LOCAL_CONFIG_PATH}"
else
  echo "==> reusing local config: ${LOCAL_CONFIG_PATH}"
fi

site_url_override="${SITE_URL}" perl -0pi -e 's/NEXT_PUBLIC_SITE_URL = ".*?"/NEXT_PUBLIC_SITE_URL = "$ENV{site_url_override}"/g' "${LOCAL_CONFIG_PATH}"

if ! section_has_key "d1_databases" "database_id" "${LOCAL_CONFIG_PATH}"; then
  if has_match '^\[\[d1_databases\]\]' "${LOCAL_CONFIG_PATH}"; then
    strip_array_section "d1_databases" "${LOCAL_CONFIG_PATH}"
  fi

  npx wrangler d1 create "${DB_NAME}" \
    --binding DB \
    --use-remote \
    --update-config \
    -c "${LOCAL_CONFIG_PATH}"
fi

if ! section_has_key "r2_buckets" "bucket_name" "${LOCAL_CONFIG_PATH}"; then
  if has_match '^\[\[r2_buckets\]\]' "${LOCAL_CONFIG_PATH}"; then
    strip_array_section "r2_buckets" "${LOCAL_CONFIG_PATH}"
  fi

  npx wrangler r2 bucket create "${R2_NAME}" \
    --binding IMAGES \
    --update-config \
    -c "${LOCAL_CONFIG_PATH}"
fi

if [[ "${WITH_KV}" == "1" ]] && ! has_match '^\[\[kv_namespaces\]\]' "${LOCAL_CONFIG_PATH}"; then
  npx wrangler kv namespace create "${KV_NAME}" \
    --binding CACHE \
    --update-config \
    -c "${LOCAL_CONFIG_PATH}"
fi

npx wrangler d1 execute DB \
  --remote \
  --file="${REPO_ROOT}/db/schema.sql" \
  -c "${LOCAL_CONFIG_PATH}"

if [[ -f "${SEED_TEMPLATE_PATH}" ]]; then
  npx wrangler d1 execute DB \
    --remote \
    --file="${SEED_TEMPLATE_PATH}" \
    -c "${LOCAL_CONFIG_PATH}"
fi

cat <<EOF
Cloudflare resource initialization complete.
Current config:
  ${LOCAL_CONFIG_PATH}

Next steps:
  1. Prepare local env vars: cp .env.example .env.local
  2. Set production secrets:
     npx wrangler secret put ADMIN_PASSWORD -c ${LOCAL_CONFIG_PATH}
     npx wrangler secret put ADMIN_TOKEN_SALT -c ${LOCAL_CONFIG_PATH}
     npx wrangler secret put AI_CONFIG_ENCRYPTION_SECRET -c ${LOCAL_CONFIG_PATH}
     npx wrangler secret put AI_API_KEY -c ${LOCAL_CONFIG_PATH}   # optional
  3. Generate types: npm run cf-typegen
  4. Deploy: npm run deploy
EOF
