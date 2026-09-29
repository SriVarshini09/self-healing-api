#!/bin/sh
set -eu

api_url_b64=$(printf '%s' "${VITE_API_URL:-}" | base64 | tr -d '\n')
api_key_b64=$(printf '%s' "${VITE_SHAPI_API_KEY:-}" | base64 | tr -d '\n')

cat > /usr/share/nginx/html/config.js <<EOF
window.__SHAPI_CONFIG__ = {
  apiUrl: atob("${api_url_b64}"),
  apiKey: atob("${api_key_b64}")
};
EOF
