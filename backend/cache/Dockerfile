# syntax=docker/dockerfile:1
FROM golang:1.24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git build-base

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o main ./cmd/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/main .
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app
USER app
EXPOSE 8080
CMD ["./main"]
