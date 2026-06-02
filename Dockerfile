FROM node:24-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS dev

COPY tsconfig.json ./
COPY src ./src
COPY templates ./templates

EXPOSE 3000

CMD ["pnpm", "dev"]

FROM base AS build

COPY . .
RUN pnpm build

FROM node:24-slim AS runner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
COPY --from=build /app/templates ./templates

EXPOSE 3000

CMD ["pnpm", "start"]
