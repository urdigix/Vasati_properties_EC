FROM node:24-alpine

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./server.js
COPY server ./server
COPY db ./db
COPY public ./public

RUN mkdir -p /app/data /app/public/uploads/properties /app/public/uploads/brochures \
    /app/storage/uploads/properties /app/storage/uploads/brochures \
  && chown -R node:node /app/data /app/public/uploads /app/storage

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
