FROM node:24-alpine AS node-builder
WORKDIR /app

COPY package.json .
COPY package-lock.json .
COPY . .

RUN npm install
RUN npm run build
RUN rm dist/playlist.json

FROM nginx:alpine

# Build context is the repo root, so these paths are prefixed with .archive/static/
COPY .archive/static/static-env-handler.sh /docker-entrypoint.d/01-static-env-handler.sh
RUN chmod +x /docker-entrypoint.d/01-static-env-handler.sh

COPY --from=node-builder /app/dist /usr/share/nginx/html
COPY .archive/static/nginx.conf /etc/nginx/conf.d/default.conf
CMD ["nginx", "-g", "daemon off;"]
