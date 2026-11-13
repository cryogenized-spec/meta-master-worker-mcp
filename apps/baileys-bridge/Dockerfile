# FUTURE Cloudflare Container image build scaffold.
# Running a linked-device session from container storage is DISABLED until
# a separately reviewed persistent, encrypted auth store is implemented.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    BAILEYS_HOST_MODE=cloudflare-container \
    BAILEYS_ENABLE=false
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
