# syntax=docker/dockerfile:1

# ── Stage 1: cargo-chef planner ──────────────────────────────────────────────
FROM lukemathwalker/cargo-chef:latest-rust-1.91-alpine AS planner
WORKDIR /app
COPY Cargo.lock Cargo.toml ./
COPY src src/
COPY migrations migrations/
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 2: cook (compile dependencies only) ────────────────────────────────
# This layer is cached as long as Cargo.lock / Cargo.toml don't change.
FROM lukemathwalker/cargo-chef:latest-rust-1.91-alpine AS builder
RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconfig
WORKDIR /app
COPY --from=planner /app/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo chef cook --release --recipe-path recipe.json

# ── Stage 3: build application code ──────────────────────────────────────────
# Only reruns when src/ changes. Deps are already compiled above.
COPY Cargo.lock Cargo.toml ./
COPY src src/
COPY migrations migrations/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release && \
    cp target/release/routes /app/routes_bin

# ── Stage 4: minimal runtime image ───────────────────────────────────────────
FROM alpine:latest
RUN apk add --no-cache ca-certificates openssl wget
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /app/routes_bin ./app
COPY migrations ./migrations
RUN chown -R app:app /app
USER app
EXPOSE 8080
CMD ["./app"]
