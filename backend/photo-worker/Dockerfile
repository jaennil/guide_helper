# syntax=docker/dockerfile:1
FROM rust:1.91.0-alpine AS builder

RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconfig

WORKDIR /app

COPY Cargo.lock Cargo.toml ./
COPY src src/

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && \
    cp target/release/photo-worker /app/photo_worker_bin

FROM alpine:latest

RUN apk add --no-cache ca-certificates openssl

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/photo_worker_bin ./app

RUN chown -R app:app /app

USER app

CMD ["./app"]
