FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS node-builder
WORKDIR /app

# The Node project lives in web/ (build context is still the repo root)
COPY web/package.json .
COPY web/package-lock.json .
COPY web/ .

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
