FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS node-builder
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
