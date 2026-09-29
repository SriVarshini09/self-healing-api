#!/bin/sh
set -eu

./apps/backend/node_modules/.bin/prisma migrate deploy --schema apps/backend/prisma/schema.prisma
exec node apps/backend/dist/index.js
