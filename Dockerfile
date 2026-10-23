# syntax=docker/dockerfile:1

# Debian (glibc), not Alpine: better-sqlite3's native module must match the
# libc it runs on, and a musl mismatch only shows up at runtime.

# Build stage: the compiler toolchain for better-sqlite3, dev dependencies,
# and the TypeScript and Vite builds.
FROM node:22-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# Runtime stage: no toolchain; production dependencies and the build only.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4400 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The app files stay root-owned, so the app cannot modify itself. Only /data
# is writable by the unprivileged `node` user (uid 1000, gid 1000) that the
# process runs as. A bind mount over /data keeps its host owner, so the host
# directory must be writable by uid 1000 (see README).
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4400
# node directly, not `npm start`, so SIGTERM reaches the server's shutdown handler.
CMD ["node", "dist/server/main.js"]
