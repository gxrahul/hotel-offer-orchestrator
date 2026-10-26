# syntax=docker/dockerfile:1

# Debian (glibc) base: the Temporal SDK ships a native Rust core.
FROM node:24.22.1-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
# API by default; the worker service overrides this with `node dist/temporal/worker.js`.
CMD ["node", "dist/api/server.js"]
