FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
ENV PNPM_REGISTRY=https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN mkdir -p prisma/data \
  && pnpm exec prisma generate \
  && pnpm build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/.env.example ./.env.example
# Remove "type":"module" so Node.js runs in CJS mode (PrismaClient is CJS)
RUN node -e "const p=require('./package.json'); delete p.type; require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2))"
RUN mkdir -p prisma/data
EXPOSE 3000
CMD ["node", "dist/index.js"]
