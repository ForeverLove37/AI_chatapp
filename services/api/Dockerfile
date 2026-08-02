FROM node:24-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY services/api/package.json ./services/api/package.json
RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm", "run", "start", "--workspace=@adaptive-chat/api"]
