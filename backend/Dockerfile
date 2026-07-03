# =============================================================================
# Dockerfile · CRM Calebe Associados — backend
# Multi-stage com Node 20 Alpine · imagem mínima otimizada
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json ./
COPY prisma ./prisma
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini

# Usuário não-root (segurança)
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/prisma ./prisma
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs package.json ./

RUN npx prisma generate

USER nodejs
ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

ENTRYPOINT ["tini","--"]
CMD ["node","src/server.js"]
