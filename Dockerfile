# syntax=docker/dockerfile:1
# knx2home — static Next.js export served by a tiny Node HTTP server.
# Build: docker build -t knx2home .
FROM node:24-alpine AS base

# ---- dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The app is 100% client-side; static export matches the GitHub Pages CI.
RUN npm run build

# ---- runner ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# tini as PID 1 so signals and zombie reaping behave correctly in Docker.
# openssl is used by the entrypoint to generate a self-signed TLS cert.
RUN apk add --no-cache tini openssl
COPY --from=builder /app/out ./out
COPY --from=builder /app/docker/server.js ./server.js
COPY --from=builder /app/docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh
EXPOSE 3000
# Run as root to generate the TLS cert, then drop to the node user inside the
# entrypoint. (tini remains PID 1 to reap zombies and forward signals.)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/entrypoint.sh"]
