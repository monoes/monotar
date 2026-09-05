FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY services/avatar-gateway/package.json services/avatar-gateway/package.json
RUN pnpm install --frozen-lockfile --filter @monotar/avatar-gateway...
COPY services/avatar-gateway services/avatar-gateway

FROM node:24-slim
WORKDIR /repo
RUN corepack enable
COPY --from=build /repo /repo
WORKDIR /repo/services/avatar-gateway
EXPOSE 4100
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
