FROM node:24.4.1-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init curl openssl
RUN npm install -g pnpm@10

COPY . .

RUN pnpm install

RUN pnpm run db:generate && pnpm run build

# Remove unnecessary files to reduce image size
RUN curl -sf https://gobinaries.com/tj/node-prune | sh && \
    node-prune --exclude **/*.mmdb


ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/apps/api

CMD ["node", "dist/src/main.js"]
