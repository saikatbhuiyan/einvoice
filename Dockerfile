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
# musl-libc Alpine images. Installed here (the one shared dev image every service's container
# runs, differentiated only by `command`) rather than conditionally, since docker-compose.dev.yml
# has no per-app dev image to scope this to — every dev container pays this image-size cost, not
# just pdf-generator's, which is the same "one shared dev image" tradeoff this Dockerfile already
# makes everywhere else. PUPPETEER_EXECUTABLE_PATH tells puppeteer-core exactly where to find it.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["pnpm", "dev"]

FROM development AS builder

ARG APP_NAME

RUN pnpm nx run ${APP_NAME}:build:production
RUN pnpm nx run ${APP_NAME}:prune-lockfile

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

COPY --from=builder /app/dist/apps/${APP_NAME}/main.js ./main.js
COPY --from=builder /app/dist/apps/${APP_NAME}/package.json ./package.json
COPY --from=builder /app/dist/apps/${APP_NAME}/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --prod --frozen-lockfile --ignore-scripts

EXPOSE 3000

CMD ["node", "main.js"]
