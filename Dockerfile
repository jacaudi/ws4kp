# Build stage: needs the full toolchain (gulp, webpack, terser, sass) to emit dist/.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .

RUN npm run build

# Runtime stage: production dependencies only, so none of the build toolchain
# reaches the shipped image. Only the paths the server actually touches with
# DIST=1 are copied -- everything else is either inside dist/ or build-time only.
FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Built output: served at / and holds the compiled JS/CSS, images and fonts.
COPY --from=build /app/dist ./dist

# Server entry point and its imports.
COPY index.mjs ./
COPY proxy ./proxy
COPY src ./src

# EJS templates: index.mjs sets the ejs view engine and renders 'index' per
# request, so views/ is needed at runtime, not only at build time.
COPY views ./views

# Served by express.static under DIST=1. src/playlist-reader.mjs also reads
# server/music (and server/music/default) at startup to build the playlist.
COPY server/scripts ./server/scripts
COPY server/music ./server/music

# Read and parsed at startup by index.mjs.
COPY datagenerators/output ./datagenerators/output

EXPOSE 8080

ENV DIST=1
CMD ["npm", "start"]
