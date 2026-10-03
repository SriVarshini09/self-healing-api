FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && for attempt in 1 2 3 4 5; do corepack prepare pnpm@9.0.0 --activate && exit 0; echo "pnpm bootstrap attempt $attempt failed; retrying"; sleep $((attempt * 5)); done; exit 1
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @shapi/backend exec prisma generate
RUN pnpm --filter @shapi/backend... build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app ./
COPY docker/backend-entrypoint.sh /usr/local/bin/shapi-backend-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/shapi-backend-entrypoint && chmod +x /usr/local/bin/shapi-backend-entrypoint

# The backend only reads the immutable application bundle and talks to
# PostgreSQL; run it without root privileges in the production container.
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3001') + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/shapi-backend-entrypoint"]
