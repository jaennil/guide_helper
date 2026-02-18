FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY nginx-tile-cache.conf /etc/nginx/conf.d/00-tile-cache.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh

EXPOSE 80

CMD ["/docker-entrypoint.sh"]
