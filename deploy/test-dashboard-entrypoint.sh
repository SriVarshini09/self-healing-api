#!/bin/sh
# Proves the dashboard entrypoint never publishes an API key unless explicitly allowed.
# Run: sh deploy/test-dashboard-entrypoint.sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0

check() { # name, expected-apiKey-state (empty|present), env assignments...
  name="$1"; expect="$2"; shift 2
  out="$tmp/config.js"; rm -f "$out"
  env -i PATH="$PATH" SHAPI_DASHBOARD_CONFIG_PATH="$out" "$@" sh "$here/dashboard-entrypoint.sh" 2>"$tmp/stderr" || { echo "FAIL $name: entrypoint exited non-zero"; fail=1; return; }
  empty=$(grep -c 'apiKey: atob("")' "$out" || true)
  if [ "$expect" = "empty" ] && [ "$empty" = "1" ]; then echo "ok   $name"; else
    if [ "$expect" = "present" ] && [ "$empty" = "0" ]; then echo "ok   $name"; else echo "FAIL $name: expected apiKey $expect"; cat "$out"; fail=1; fi
  fi
}

check "no key configured -> empty" empty VITE_API_URL=/api/v1
check "key set but not allowed -> IGNORED" empty VITE_API_URL=/api/v1 VITE_SHAPI_API_KEY=shapi_secret_value_123
grep -q "IGNORED" "$tmp/stderr" || { echo "FAIL: no warning printed when a key is ignored"; fail=1; }
check "key set, allow flag is not exactly true -> IGNORED" empty VITE_SHAPI_API_KEY=shapi_secret_value_123 SHAPI_DASHBOARD_ALLOW_PUBLIC_KEY=yes
check "key set and explicitly allowed -> published" present VITE_SHAPI_API_KEY=shapi_secret_value_123 SHAPI_DASHBOARD_ALLOW_PUBLIC_KEY=true

# The ignored key must not appear anywhere in the output, encoded or not.
env -i PATH="$PATH" SHAPI_DASHBOARD_CONFIG_PATH="$tmp/leak.js" VITE_SHAPI_API_KEY=shapi_secret_value_123 sh "$here/dashboard-entrypoint.sh" 2>/dev/null
if grep -q "shapi_secret_value_123" "$tmp/leak.js" || grep -q "$(printf 'shapi_secret_value_123' | base64 | tr -d '\n')" "$tmp/leak.js"; then echo "FAIL: ignored key leaked into config.js"; fail=1; else echo "ok   ignored key is absent from config.js"; fi

[ "$fail" = "0" ] && echo "DASHBOARD ENTRYPOINT OK" || { echo "DASHBOARD ENTRYPOINT FAILED"; exit 1; }
