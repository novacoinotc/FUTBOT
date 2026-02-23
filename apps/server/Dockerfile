FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/server/ ./apps/server/
COPY packages/shared/ ./packages/shared/
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=server

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/ ./
WORKDIR /app/apps/server
EXPOSE 3001
CMD ["node", "dist/index.js"]
