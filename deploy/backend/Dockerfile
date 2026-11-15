FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data UPLOADS_DIR=/app/storage/uploads
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./server.js
COPY server ./server
COPY db ./db
COPY public ./public
RUN mkdir -p /app/data /app/storage/uploads/properties /app/storage/uploads/brochures \
    && chown -R node:node /app/data /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
