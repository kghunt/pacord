# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── Production stage ─────────────────────────────────────────────────────────
# node_modules are copied from the build stage so npm never runs under QEMU
# emulation (Node 22 uses instructions older QEMU versions can't handle).
FROM node:22-alpine
WORKDIR /app
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY package.json ./
ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "dist/server/index.js"]
