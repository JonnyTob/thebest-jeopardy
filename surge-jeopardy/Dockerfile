FROM node:20-alpine AS builder
WORKDIR /build

# Build backend first: the frontend's @shared/* alias resolves into
# ../backend/src/shared, so that source must exist on disk before the
# frontend build (tsc + vite) runs.
COPY backend/package*.json backend/
RUN cd backend && npm ci
COPY backend/ backend/
RUN cd backend && npm run build

# Build frontend (outputs to /build/backend/public via vite.config.ts outDir)
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend/ frontend/
RUN cd frontend && npm run build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

# Compiled backend
COPY --from=builder /build/backend/dist ./dist
# Built frontend (served as static files by Express)
COPY --from=builder /build/backend/public ./public
# package.json for production dep install
COPY --from=builder /build/backend/package*.json ./
RUN npm ci --omit=dev

EXPOSE 3001

# /app/data is where boards and media uploads live — mount a volume here
VOLUME /app/data

CMD ["node", "dist/index.js"]
