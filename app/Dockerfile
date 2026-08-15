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
COPY --from=builder /app/db ./db

ENV PORT=3000
EXPOSE 3000

# db/migrate.js applies schema + the one-time Supabase→Postgres data copy
# before the server starts (no-op without DATABASE_URL). It exits before Next
# binds $PORT; a migration failure fails the deploy loudly.
CMD ["sh", "-c", "node db/migrate.js && npm start"]
