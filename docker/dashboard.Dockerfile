FROM node:20-bookworm-slim AS build

WORKDIR /app/dashboard
RUN corepack enable && for attempt in 1 2 3 4 5; do corepack prepare pnpm@9.0.0 --activate && exit 0; echo "pnpm bootstrap attempt $attempt failed; retrying"; sleep $((attempt * 5)); done; exit 1

COPY dashboard/package.json dashboard/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-workspace
COPY dashboard/ ./
RUN pnpm build

FROM nginx:1.27-alpine AS runtime

ENV PORT=80
ENV BACKEND_HOSTPORT=backend:3001
ENV NGINX_ENVSUBST_FILTER=^(PORT|BACKEND_HOSTPORT)$
COPY --from=build /app/dashboard/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/dashboard-entrypoint.sh /docker-entrypoint.d/40-shapi-config.sh
COPY deploy/dashboard-healthcheck.sh /usr/local/bin/shapi-dashboard-healthcheck
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-shapi-config.sh /usr/local/bin/shapi-dashboard-healthcheck && chmod +x /docker-entrypoint.d/40-shapi-config.sh /usr/local/bin/shapi-dashboard-healthcheck

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["/usr/local/bin/shapi-dashboard-healthcheck"]
