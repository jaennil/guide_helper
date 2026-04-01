# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

ARG VITE_GRAPHHOPPER_API_KEY=""
ENV VITE_GRAPHHOPPER_API_KEY=$VITE_GRAPHHOPPER_API_KEY

ARG VITE_STADIA_API_KEY=""
ENV VITE_STADIA_API_KEY=$VITE_STADIA_API_KEY

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY nginx-tile-cache.conf /etc/nginx/conf.d/00-tile-cache.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
EXPOSE 80
CMD ["/docker-entrypoint.sh"]
