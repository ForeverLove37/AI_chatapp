FROM node:24-bookworm-slim AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY services/api/package.json ./services/api/package.json
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_BASE_URL=https://chatapi.zengjunjie.com
RUN npm run build --workspace=@adaptive-chat/web

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace=@adaptive-chat/web", "--", "-p", "3001"]
