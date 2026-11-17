FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL is only needed so the Prisma CLI can load prisma.config.ts; no
# connection is made at build time.
RUN DATABASE_URL="mysql://build:build@127.0.0.1:3306/build" npx prisma generate
RUN npm run build
RUN npm run build:worker

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The worker runs from the same image under a different command. It is bundled
# with external packages, so it reuses the standalone tree's node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.cjs ./dist/worker.cjs

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
