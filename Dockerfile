FROM node:24-alpine
ENV NODE_ENV=production TZ=America/Argentina/Buenos_Aires DB_RUTA=/datos/petalos.db
RUN apk add --no-cache tzdata && mkdir -p /datos && chown node:node /datos
WORKDIR /app
COPY --chown=node:node . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/salud || exit 1
CMD ["node", "--no-warnings", "server.js"]
