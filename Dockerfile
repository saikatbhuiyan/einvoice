FROM node:22-alpine AS base

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json jest.config.ts jest.preset.js ./
COPY apps ./apps
COPY libs ./libs

RUN pnpm install --frozen-lockfile \
    && rm -rf .nx/cache \
    && echo "reset nx cache for volume mount"

FROM base AS development

ENV NODE_ENV=development

# pdf-generator uses puppeteer-core against a system Chromium rather than puppeteer's own bundled
# download — Puppeteer's bundled Chromium is built against glibc and is known to be unreliable on
# musl-libc Alpine images. Conditional on APP_NAME (docker-compose.dev.yml now passes it as a
# build arg for every service, not just pdf-generator's) so the ~1.1GB Chromium + its codec/font
# dependency tree only lands in pdf-generator's own dev image — every other service's `pnpm
# install` layer above is still fully cache-shared across these builds (this ARG is only
# referenced below), so this didn't reintroduce a separate full rebuild per app. Confirmed live:
# before this, invoice/media/payment's dev images were 2.2GB each (same unconditional install as
# pdf-generator's, despite never touching Puppeteer) vs. ~1.04GB for bff/product/user-access.
ARG APP_NAME
RUN if [ "$APP_NAME" = "pdf-generator" ]; then \
      apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont; \
    fi
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["pnpm", "dev"]

FROM development AS builder

ARG APP_NAME

# The build writes everything the runtime needs into dist/apps/<app>: main.js, its assets (gRPC
# .proto files, templates -- see each webpack.config.js), and a package.json + pnpm-lock.yaml
# pruned to the bundle's runtime dependencies (webpack's generatePackageJson). There is no
# separate prune-lockfile step: Nx's needs a per-app package.json, which no app has (by design).
RUN pnpm nx run ${APP_NAME}:build:production

FROM node:22-alpine AS runtime

WORKDIR /app

RUN corepack enable

ARG APP_NAME
ENV NODE_ENV=production

# Unlike the shared `development` stage above, each app gets its own runtime image here — so
# Chromium is only installed into pdf-generator's image, keeping every other service's prod image
# exactly as lean as it was before this app existed.
RUN if [ "$APP_NAME" = "pdf-generator" ]; then \
      apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont; \
    fi
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# The whole output, not just main.js: gRPC apps load .proto files from next to main.js at runtime
# (grpc.config.ts), so copying main.js alone left bff/authorizer/user-access unable to start.
COPY --from=builder /app/dist/apps/${APP_NAME}/ ./

RUN pnpm install --prod --frozen-lockfile --ignore-scripts

EXPOSE 3000

CMD ["node", "main.js"]
