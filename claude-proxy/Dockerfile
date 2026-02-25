# syntax=docker/dockerfile:1
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

COPY server.js ./

EXPOSE 3099
CMD ["node", "server.js"]
