FROM node:24-bookworm-slim AS node-runtime

FROM postgres:17-bookworm

COPY --from=node-runtime /usr/local/ /usr/local/

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY services/api/package.json ./services/api/package.json
RUN npm ci

COPY . .

ENV NODE_ENV=production

CMD ["npm", "run", "worker", "--workspace=@adaptive-chat/api"]
