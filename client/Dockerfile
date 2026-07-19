# NexArch console image: static build served by nginx, which also proxies
# /api to the server container so the browser only ever talks to one origin.
# Build context is the REPO ROOT:
#   docker build -f client/Dockerfile .

# ── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/
RUN npm ci --workspace client

COPY client client
RUN npm run build --workspace client

# ── Stage 2: serve ─────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
