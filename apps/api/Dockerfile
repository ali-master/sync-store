FROM --platform=$BUILDPLATFORM oven/bun:1.4.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run --cwd apps/api db:generate
RUN bun run --cwd packages/utils build && bun run --cwd packages/client-sdk build && bun run --cwd apps/api build

FROM --platform=$BUILDPLATFORM oven/bun:1.4.4 AS runtime-deps
WORKDIR /app
ARG TARGETARCH
COPY . .
# The init service needs Prisma; frontend/build/release tooling is not needed at runtime.
RUN bun install --frozen-lockfile --ignore-scripts --production --filter @usex/api --filter @usex/utils --cpu=$TARGETARCH
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/dashboard/dist /app/apps/dashboard/dist
COPY --from=build /app/packages/utils/dist /app/packages/utils/dist
# Keep the API tools, compiled dashboard and workspace dependency links only.
RUN rm -rf /app/venv /app/apps/docs /app/examples /app/scripts /app/docs /app/docker /app/assets \
    /app/apps/dashboard/src /app/apps/dashboard/public /app/packages/client-sdk \
    /app/packages/static-analyzer /app/apps/api/test /app/share
# Dependency source maps are only needed for debugging third-party source.
RUN find /app/node_modules -type f -name '*.map' -delete

FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY --from=runtime-deps --chown=bun:bun /app/ /app/
ENV NODE_ENV=production
ENV PORT=3000
USER bun
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["bun", "--tsconfig-override", "tsconfig.runtime.json", "dist/main.js"]
