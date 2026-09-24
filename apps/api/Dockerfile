# apps/api — Dhaka Tesla Pool API image (multi-stage).
# Built from the repository root (see docker-compose.yml build context ".").

FROM node:24-alpine AS build
WORKDIR /repo

# Install all workspace dependencies first (cache-friendly).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# Build the API.
COPY . .
RUN npm run build -w @dhaka-tesla-pool/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# Production dependencies for all workspaces (web deps are pulled in but only
# api artifacts are copied into this image).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev

COPY --from=build /repo/apps/api ./apps/api

EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]