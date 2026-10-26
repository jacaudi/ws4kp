# Build stage: needs the full toolchain (gulp, webpack, terser, sass) to emit dist/.
# The Node project lives in web/; the build sees only that directory.
FROM node:24-alpine AS build
WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY web/ .

# buildDist copies the music into dist/ for static hosting; this image serves /music from
# server/music (index.mjs, DIST=1), so the dist copy would only double the music in the image.
RUN npm run build && rm -rf dist/music

# Runtime stage: production dependencies only, so none of the build toolchain
# reaches the shipped image. Only the paths the server actually touches with
# DIST=1 are copied -- everything else is either inside dist/ or build-time only.
# The runtime layout under /app is unchanged by the move to web/: documented mounts
# (/app/server/music, /app/server/scripts/custom.js) and release-republish's
# /app/package.json read depend on it.
FROM node:24-alpine
WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Built output: served at / and holds the compiled JS/CSS, images and fonts.
COPY --from=build /app/dist ./dist

# Server entry point and its imports.
COPY web/index.mjs ./
COPY web/proxy ./proxy
COPY web/src ./src

# EJS templates: index.mjs sets the ejs view engine and renders 'index' per
# request, so views/ is needed at runtime, not only at build time.
COPY web/views ./views

# Served by express.static under DIST=1. src/playlist-reader.mjs also reads
# server/music (and server/music/default) at startup to build the playlist.
COPY web/server/scripts ./server/scripts
COPY web/server/music ./server/music

# Read and parsed at startup by index.mjs.
COPY web/datagenerators/output ./datagenerators/output

EXPOSE 8080

# busybox wget ships with alpine; manifest.json is a small static file from dist/
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
	CMD wget -q --spider "http://127.0.0.1:8080/manifest.json" || exit 1

# NODE_ENV=production is read by Express, not by this project's own code
# (nothing here branches on it). It enables the view cache, so the EJS
# templates are compiled once instead of re-read on every request, and it
# stops finalhandler from putting err.stack into 5xx response bodies.
ENV NODE_ENV=production
ENV DIST=1
CMD ["npm", "start"]
