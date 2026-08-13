# Stage 1: Base
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Stage 2: Build Dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm config set registry https://registry.npmmirror.com && \
    pnpm install --frozen-lockfile

# Stage 3: Build
FROM deps AS build
COPY . .
RUN pnpm exec prisma generate && \
    pnpm build

# Stage 4: Production Dependencies
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry https://registry.npmmirror.com && \
    pnpm install --prod --frozen-lockfile

# Stage 5: Runner
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# Create app user and set permissions
RUN groupadd -r nodejs && useradd -r -g nodejs nodeuser && \
    mkdir -p /app/data /app/prisma/data && \
    chown -R nodeuser:nodejs /app

# Copy production dependencies
COPY --from=prod-deps --chown=nodeuser:nodejs /app/node_modules ./node_modules
# Copy built artifacts
COPY --from=build --chown=nodeuser:nodejs /app/dist ./dist
COPY --from=build --chown=nodeuser:nodejs /app/prisma ./prisma
COPY --from=build --chown=nodeuser:nodejs /app/package.json ./package.json
COPY --from=build --chown=nodeuser:nodejs /app/.env.example ./.env.example

# Fix for Prisma CJS/ESM compatibility
RUN node -e "const p=require('./package.json'); delete p.type; require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2))"

USER nodeuser

EXPOSE 3000
CMD ["node", "dist/index.js"]
