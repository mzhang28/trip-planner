# syntax=docker/dockerfile:1

# Two images out of one file: `api` runs the Hono server, `web` serves the built
# PWA through nginx and forwards the API's paths to it. Both take their
# dependencies from the `deps` stage, so the workspace is installed once.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Reads the pnpm version from the packageManager field in package.json.
RUN corepack enable
WORKDIR /app


# Only the manifests are copied here, so editing a source file reuses the
# cached install instead of repeating it.
FROM base AS deps
# better-sqlite3 ships a binding.gyp and no install script of its own, so pnpm
# falls back to compiling it. The toolchain is confined to this stage — the two
# images below copy the finished node_modules and not the compiler.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/crdt/package.json packages/crdt/
COPY packages/schema/package.json packages/schema/
COPY packages/ui/package.json packages/ui/
# The two apps and the packages they depend on. The root package holds Playwright
# and Vitest, which nothing in either image runs.
RUN pnpm install --frozen-lockfile --filter "@trip/api..." --filter "@trip/web..."


# The API runs its TypeScript sources directly, through tsx's loader in the same
# process — no build output, and signals reach the server's shutdown handler.
FROM base AS api
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/crdt/node_modules ./packages/crdt/node_modules
COPY --from=deps /app/packages/schema/node_modules ./packages/schema/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/crdt packages/crdt
COPY packages/schema packages/schema
COPY apps/api apps/api

# DATABASE_PATH and BLOB_DIR resolve against the repository root, which is
# /app here, so this directory is what a volume mounts over.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
WORKDIR /app/apps/api
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/main.ts"]


FROM base AS web-build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/crdt/node_modules ./packages/crdt/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY . .
# Writes the PWA icons from the SVG, then bundles.
RUN pnpm --filter @trip/web build


FROM nginx:alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
