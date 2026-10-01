#!/bin/sh
set -eu

wget -q -O - "http://127.0.0.1:${PORT:-80}/health" >/dev/null
