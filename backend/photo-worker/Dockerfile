FROM rust:1.91.0-alpine AS builder

RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconfig

WORKDIR /app

COPY Cargo.lock Cargo.toml ./
COPY src src/

RUN cargo build --release

FROM alpine:latest

RUN apk add --no-cache ca-certificates openssl

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/target/release/photo-worker ./app

RUN chown -R app:app /app

USER app

CMD ["./app"]
