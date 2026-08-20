# syntax=docker/dockerfile:1

# One container: the API serves the built client from the same origin, so
# nothing sits in front of it. In dev the Vite server does that job instead and
# proxies the API's paths back to it, which is why WEB_DIST is set only here.
#
# Each stage copies only the files it reads, so editing the API leaves the whole
# client build cached and editing the client leaves the install cached.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app


FROM base AS deps
# better-sqlite3 ships a binding.gyp and no install script of its own, so pnpm
# falls back to compiling it. The toolchain is confined to this stage — the
# image below copies the finished node_modules and not the compiler.
RUN apk add --no-cache python3 make g++

# Fetches the pnpm version named in packageManager. On its own layer, so a
# change to the lockfile or to any other manifest does not fetch it again.
COPY package.json ./
RUN corepack install

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/crdt/package.json packages/crdt/
COPY packages/proto/package.json packages/proto/
COPY packages/schema/package.json packages/schema/
COPY packages/ui/package.json packages/ui/
# Only the two apps and the packages they depend on. The root package holds
# Playwright, Vitest, and the protobuf compiler, none of which the image runs:
# the generated client is committed, so nothing here regenerates it.
#
# The store is mounted rather than copied in, so editing one dependency
# re-links the rest from the cache instead of downloading them again. It also
# holds the compiled better-sqlite3, which is otherwise the slowest part of this.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store \
    --filter "@trip/api..." --filter "@trip/web..."


# Only what the client build reads. Nothing here depends on apps/api, so an API
# change does not rebuild the client.
FROM deps AS web-build
COPY tsconfig.base.json ./
COPY packages/crdt packages/crdt
COPY packages/proto packages/proto
COPY packages/ui packages/ui
COPY apps/web apps/web
# Stamped into the bundle, which is what the settings screen shows for the
# version it is running. .dockerignore keeps .git out of the build context, so
# the commit has to be handed in; without it the build time stands alone, and
# that is already different for every deployment. Declared after the COPYs so
# passing a new commit does not invalidate the layers above it.
ARG APP_COMMIT=""
ENV APP_COMMIT=$APP_COMMIT
# Writes the PWA icons from the SVG, then bundles.
RUN pnpm --filter @trip/web build
# A .gz beside each file the server may hand back compressed. It serves those as
# they are, so nothing is gzipped per request — and the Automerge WebAssembly,
# the largest thing here by far, goes over the wire at about a quarter its size.
RUN find apps/web/dist -type f \
    \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.wasm' \
    -o -name '*.svg' -o -name '*.json' -o -name '*.webmanifest' \) \
    -exec gzip -9 -k {} +


# The API runs its TypeScript sources directly, through tsx's loader in the same
# process — no build output, and signals reach the server's shutdown handler.
FROM base AS runtime
ENV NODE_ENV=production \
    WEB_DIST=apps/web/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/crdt/node_modules ./packages/crdt/node_modules
COPY --from=deps /app/packages/proto/node_modules ./packages/proto/node_modules
COPY --from=deps /app/packages/schema/node_modules ./packages/schema/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/crdt packages/crdt
COPY packages/proto packages/proto
COPY packages/schema packages/schema
COPY apps/api apps/api
COPY --from=web-build /app/apps/web/dist apps/web/dist

# DATABASE_PATH and BLOB_DIR resolve against the repository root, which is
# /app here, so this directory is what a volume mounts over.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
WORKDIR /app/apps/api
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/main.ts"]
