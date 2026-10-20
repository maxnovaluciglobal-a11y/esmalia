# Self-hosted fallback for Esmalia (see docs/SLO.md and docs/DISASTER_RECOVERY.md).
# Builds the same app Vercel runs, with Nitro's `node-server` preset, and serves
# it from a standalone Node server in .output/.

# ---------- Build ----------
FROM node:24-alpine AS build
WORKDIR /app

# Dependencies (cacheable layer). HUSKY=0 skips the git hooks install from
# the `prepare` script: there is no .git inside the image.
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Rest of the source, then build
COPY . .

ENV NITRO_PRESET=node-server
ENV NODE_ENV=production

# VITE_* variables are baked into the browser bundle at build time
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

RUN npm run build

# ---------- Runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/.output ./.output
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

RUN addgroup -S esmalia && adduser -S esmalia -G esmalia && chown -R esmalia:esmalia /app
USER esmalia

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
