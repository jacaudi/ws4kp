# Three stages: the browser app (Node, build time only), the Go binary that embeds it, and
# a distroless runtime that holds nothing but that binary. Base images are pinned by digest;
# Renovate's docker:pinDigests keeps them current.

# The site: gulp, webpack and sass emit web/dist/. The output is architecture-independent,
# so this stage always runs on the build machine's own platform.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build && node -p "require('./package.json').version" > /src/version

# The binary, cross-compiled for the target platform, so no emulation is needed.
FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS go
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY web/embed.go web/
COPY web/server/scripts/ web/server/scripts/
COPY --from=web /src/web/dist/ web/dist/
COPY --from=web /src/version /src/version
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
	go build -trimpath -ldflags "-s -w -X main.version=$(cat /src/version)" -o /out/ws4kp ./cmd/ws4kp

# The runtime: no shell, no package manager, uid 65532. Mounts under /app/server/music and
# /app/server/scripts must be readable by that user.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:18f4cc26c9ffa7f20a359298be7deadac5c607c8e03a02b8119f1a5fc2f82c99
WORKDIR /app
COPY --from=go /out/ws4kp /app/ws4kp
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 CMD ["/app/ws4kp", "healthcheck"]
ENTRYPOINT ["/app/ws4kp"]
