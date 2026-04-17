FROM node:20-alpine AS base

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json jest.config.ts jest.preset.js ./
COPY apps ./apps
COPY libs ./libs

RUN pnpm install --frozen-lockfile

FROM base AS development

ENV NODE_ENV=development

EXPOSE 3000

CMD ["pnpm", "dev"]

FROM development AS builder

ARG APP_NAME

RUN pnpm nx run ${APP_NAME}:build:production
RUN pnpm nx run ${APP_NAME}:prune-lockfile

FROM node:20-alpine AS runtime

WORKDIR /app

RUN corepack enable

ARG APP_NAME
ENV NODE_ENV=production

COPY --from=builder /app/dist/apps/${APP_NAME}/main.js ./main.js
COPY --from=builder /app/dist/apps/${APP_NAME}/package.json ./package.json
COPY --from=builder /app/dist/apps/${APP_NAME}/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --prod --frozen-lockfile --ignore-scripts

EXPOSE 3000

CMD ["node", "main.js"]
