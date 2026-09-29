FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @shapi/dashboard build

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/dashboard-entrypoint.sh /docker-entrypoint.d/40-shapi-config.sh
RUN chmod +x /docker-entrypoint.d/40-shapi-config.sh

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O - http://127.0.0.1/health >/dev/null || exit 1
