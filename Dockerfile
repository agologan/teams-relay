FROM ghcr.io/pnpm/pnpm:12-alpine AS base

ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ]; then apk add --no-cache libatomic; fi

ENV PNPM_HOME=/pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./


FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile


FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build


FROM build AS dev
EXPOSE 3000
CMD ["pnpm", "dev"]


FROM node:26-alpine
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

EXPOSE 3000
USER node
WORKDIR /app

CMD ["node", "dist/server.js"]
