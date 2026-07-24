# Multi-stage build: Next.js 14 app. Contract: listen on $PORT, bind 0.0.0.0,
# answer GET /health, stay iframe-embeddable from *.plnetwork.io.

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
