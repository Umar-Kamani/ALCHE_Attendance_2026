# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm fetch

FROM toolchain AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @alche/shared build \
    && pnpm --filter @alche/web build \
    && pnpm --filter @alche/api build

FROM build AS test
ENV NODE_ENV=test
CMD ["pnpm", "--filter", "@alche/api", "test"]

FROM build AS production-deps
RUN pnpm --filter=@alche/api deploy --prod /prod/app \
    && cd /prod/app \
    && ./node_modules/.bin/prisma generate --schema ./prisma/schema.prisma

FROM node:22-bookworm-slim AS runtime
ARG BUILD_VERSION=dev
ENV NODE_ENV=production \
    PORT=8000 \
    BUILD_VERSION=$BUILD_VERSION \
    TZ=Indian/Mauritius
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=production-deps /prod/app ./
COPY --from=build /app/apps/api/public ./public
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./entrypoint.sh"]
