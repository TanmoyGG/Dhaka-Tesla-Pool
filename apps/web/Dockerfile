# apps/web — Dhaka Tesla Pool web image (multi-stage).
# Built from the repository root (see docker-compose.yml build context ".").

FROM node:24-alpine AS build
WORKDIR /repo

# Install all workspace dependencies first (cache-friendly).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# Build the Next.js app. NEXT_PUBLIC_* values are baked into the browser
# bundle, so they must be present at build time (passed as build args; the
# default is an INVALID placeholder that only exists so the image builds and
# the app starts without real Clerk credentials — see docker-compose.yml).
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_cGxhY2Vob2xkZXIuaW52YWxpZC5jbGVyay5hY2NvdW50cy5kZXYk
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
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