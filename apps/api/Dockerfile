FROM --platform=$BUILDPLATFORM oven/bun:1.4.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run --cwd apps/api db:generate
RUN bun run --cwd packages/utils build && bun run --cwd packages/client-sdk build && bun run --cwd apps/api build

FROM --platform=$BUILDPLATFORM oven/bun:1.4.4 AS runtime-deps
WORKDIR /app
COPY . .
# The init service needs Prisma; frontend/build/release tooling is not needed at runtime.
RUN bun install --frozen-lockfile --ignore-scripts --production --filter @usex/api --filter @usex/utils --cpu=x64 --cpu=arm64
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/dashboard/dist /app/apps/dashboard/dist
COPY --from=build /app/packages/utils/dist /app/packages/utils/dist
# Small dependency layers avoid long single-upload proxy timeouts and allow independent retries.
RUN set -eu; cd /; mkdir -p /layers/0; mv /app /layers/0/app; \
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do mkdir -p /layers/$i/app/node_modules/.bun; done; \
    i=0; for package in /layers/0/app/node_modules/.bun/*; do \
      if [ -d "$package" ] && [ ! -L "$package" ]; then \
        i=$((i % 15 + 1)); mv "$package" /layers/$i/app/node_modules/.bun/; \
      fi; \
    done

FROM oven/bun:1.4.4
WORKDIR /app
COPY --link --from=runtime-deps --chown=1000:1000 /layers/0/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/1/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/2/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/3/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/4/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/5/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/6/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/7/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/8/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/9/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/10/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/11/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/12/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/13/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/14/ /
COPY --link --from=runtime-deps --chown=1000:1000 /layers/15/ /
ENV NODE_ENV=production
ENV PORT=3000
USER bun
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["bun", "--tsconfig-override", "tsconfig.runtime.json", "dist/main.js"]
