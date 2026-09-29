FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @shapi/backend exec prisma generate
RUN pnpm --filter @shapi/backend... build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app ./
COPY docker/backend-entrypoint.sh /usr/local/bin/shapi-backend-entrypoint
RUN chmod +x /usr/local/bin/shapi-backend-entrypoint

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/shapi-backend-entrypoint"]
