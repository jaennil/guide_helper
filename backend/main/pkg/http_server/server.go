package http_server

import (
	"context"
	"net/http"
	"time"

	"github.com/jaennil/guide_helper/main/pkg/config"
	"github.com/jaennil/guide_helper/main/pkg/logger"
)

func NewServer(ctx context.Context, cfg config.Server, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      withLoggingMiddleware(ctx, handler),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}
}

func withLoggingMiddleware(ctx context.Context, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		l := logger.FromContext(ctx)

		l.Info("new request", "method", r.Method, "path", r.URL.Path, "ip", r.RemoteAddr)

		start := time.Now()

		next.ServeHTTP(w, r.WithContext(ctx))

		duration := time.Since(start)

		l.Info("new response", "method", r.Method, "path", r.URL.Path, "duration", duration)
	})
}
