FROM rust:1.91.0-alpine AS builder

RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconfig

WORKDIR /app

COPY Cargo.lock Cargo.toml ./
COPY src src/
COPY migrations migrations/

RUN cargo build --locked --release

FROM alpine:latest

RUN apk add --no-cache ca-certificates openssl wget

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/target/release/routes ./app
COPY migrations ./migrations

RUN chown -R app:app /app

USER app

EXPOSE 8080

CMD ["./app"]
