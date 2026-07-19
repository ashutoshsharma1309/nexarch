# NexArch API image.
# Build context is the REPO ROOT (npm workspaces need the root lockfile):
#   docker build -f server/Dockerfile .

# ── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Prisma engines need openssl on alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace server

COPY server/prisma server/prisma
COPY server/tsconfig.json server/
COPY server/src server/src

RUN npm run db:generate --workspace server \
  && npm run build --workspace server

# ── Stage 2: production dependencies ───────────────────────────────────────
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace server --omit=dev

# ── Stage 3: runtime ───────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=prod-deps /app/node_modules node_modules
# The generated Prisma client only exists in the build stage — carry it over.
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/node_modules/@prisma node_modules/@prisma
COPY --from=build /app/server/dist server/dist
COPY server/package.json server/

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health/live || exit 1

CMD ["node", "server/dist/index.js"]
