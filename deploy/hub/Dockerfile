# The hub: a static binary on distroless. Built from the repo root:
#   docker build -f deploy/hub/Dockerfile --build-arg VERSION=v2026.10.10.1 .
FROM --platform=$BUILDPLATFORM golang:1.23-bookworm AS build
ARG TARGETOS=linux
ARG TARGETARCH=arm64
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/hindsight-hub ./cmd/hindsight-hub
COPY internal/hubserver ./internal/hubserver
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" \
      -o /out/hindsight-hub ./cmd/hindsight-hub

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/hindsight-hub /hindsight-hub
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/hindsight-hub"]
