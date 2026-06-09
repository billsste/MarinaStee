# Marina Stee — production Docker image.
#
# Pattern A from CLAUDE.md §7.5 — image is the deploy artifact, shipped
# to GHCR by CI and `docker load`-ed onto the droplet over SSH. Mirrors
# HomeField Raise (the canonical reference) with two material deltas:
#   1. No Prisma / Postgres stage (marina-stee uses Convex; mock data
#      ships baked into the bundle).
#   2. Standalone output (next.config.ts: output: "standalone") — the
#      runner image only needs the .next/standalone tree, not the full
#      node_modules + source.
#
# Multi-stage layout:
#   deps    — install npm deps once, cache aggressively
#   builder — copy src, run `next build`, emit standalone tree
#   runner  — Alpine base, copy standalone tree + public, start node
#
# Final image ends up ~250 MB vs ~1.2 GB if we shipped the full repo.

FROM node:22-alpine AS base

# ── deps stage ──────────────────────────────────────────────
# Single npm ci per dep change. Cap heap so it doesn't OOM on
# small buildx runners.
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN NODE_OPTIONS="--max-old-space-size=4096" npm ci

# ── builder stage ───────────────────────────────────────────
# Bring deps over, copy the rest of the repo, run `next build`.
# CACHEBUST ARG forces every subsequent layer to bust BuildKit's
# registry cache on every commit — without it, the build can
# silently reuse yesterday's bundle when the SHA changes.
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG CACHEBUST=unset
RUN echo "CACHEBUST=$CACHEBUST" && npm run build

# ── runner stage ────────────────────────────────────────────
# Tiny Alpine base. Standalone output includes a copy of the
# subset of node_modules it actually needs, so we don't copy
# the deps tree here.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root for defense-in-depth — the standalone server
# only ever reads from /app, no need for root inside the container.
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Standalone build outputs are layout-stable: server.js + a
# minimal node_modules + the .next/server tree.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
