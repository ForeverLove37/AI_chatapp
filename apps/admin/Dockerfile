FROM node:24-bookworm-slim AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY services/api/package.json ./services/api/package.json
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@adaptive-chat/admin

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace=@adaptive-chat/admin", "--", "-p", "3000"]
