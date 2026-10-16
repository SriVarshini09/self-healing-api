#!/bin/sh
set -eu

# Writes the dashboard's runtime config (public: anyone who opens the site can read it).
#
# An API key must NEVER end up in this file on a site people can sign in to. When a key
# is present the dashboard skips sign-in and shows that key's workspace to every visitor,
# and the key itself is readable by anyone. So VITE_SHAPI_API_KEY is ignored unless
# SHAPI_DASHBOARD_ALLOW_PUBLIC_KEY=true, which exists for private-network setups and CI
# where the whole point is a key-only console.
out="${SHAPI_DASHBOARD_CONFIG_PATH:-/usr/share/nginx/html/config.js}"
api_key="${VITE_SHAPI_API_KEY:-}"

if [ -n "$api_key" ] && [ "${SHAPI_DASHBOARD_ALLOW_PUBLIC_KEY:-}" != "true" ]; then
  echo "WARNING: VITE_SHAPI_API_KEY is set but IGNORED. Publishing an API key in the dashboard's" >&2
  echo "public config would expose it and bypass sign-in. Remove the variable. (Private-network" >&2
  echo "setups can opt in with SHAPI_DASHBOARD_ALLOW_PUBLIC_KEY=true.)" >&2
  api_key=""
fi

api_url_b64=$(printf '%s' "${VITE_API_URL:-}" | base64 | tr -d '\n')
api_key_b64=$(printf '%s' "$api_key" | base64 | tr -d '\n')

cat > "$out" <<EOF
window.__SHAPI_CONFIG__ = {
  apiUrl: atob("${api_url_b64}"),
  apiKey: atob("${api_key_b64}")
};
EOF
