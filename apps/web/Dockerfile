# apps/web — Dhaka Tesla Pool web image (multi-stage).
# Built from the repository root (see docker-compose.yml build context ".").

FROM node:24-alpine AS build
WORKDIR /repo

# Install all workspace dependencies first (cache-friendly).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# Build the Next.js app.
COPY . .
RUN npm run build -w @dhaka-tesla-pool/web

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# Production dependencies for all workspaces.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev

COPY --from=build /repo/apps/web ./apps/web

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@dhaka-tesla-pool/web"]