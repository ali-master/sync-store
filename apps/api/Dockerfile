FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run --cwd apps/api db:generate
RUN bun run --cwd packages/utils build && bun run --cwd apps/api build

FROM oven/bun:1.4.4
WORKDIR /app
COPY --from=build --chown=bun:bun /app /app
ENV NODE_ENV=production
ENV PORT=3000
USER bun
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["bun", "--tsconfig-override", "tsconfig.runtime.json", "dist/main.js"]
