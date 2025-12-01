package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-playground/validator/v10"
	v1 "github.com/jaennil/guide_helper/backend/cache/internal/infrastructure/http/v1"
	"github.com/jaennil/guide_helper/backend/cache/internal/infrastructure/http/v1/handler"
	"github.com/jaennil/guide_helper/backend/cache/internal/repository/cache"
	"github.com/jaennil/guide_helper/backend/cache/internal/usecase"
	"github.com/jaennil/guide_helper/backend/cache/pkg/config"
	"github.com/jaennil/guide_helper/backend/cache/pkg/http_server"
	"github.com/jaennil/guide_helper/backend/cache/pkg/logger"
)

func Run(cfg *config.Config) {
	l := logger.NewZapLogger(cfg.Logger)

	l.Info("app config", "cfg", cfg)

	ctx := context.TODO()
	
	ctx = logger.WithLogger(ctx, l)

	// Initialize the cache repository
	sqliteCache, err := cache.NewSQLiteCache("file:cache.db?cache=shared&mode=memory")
	if err != nil {
		l.Fatal("failed to initialize SQLite cache", "error", err)
	}

	// Initialize the use case
	tileCacheUseCase := usecase.NewTileCacheUseCase(sqliteCache)

	// Initialize the HTTP handler
	validate := validator.New()
	handler := handler.NewHandler(validate, tileCacheUseCase)
	router := v1.NewRouter(handler, l)

	httpServer := http_server.NewServer(ctx, cfg.HTTP.Server, router)

	l.Info("starting http server...", "address", httpServer.Addr)

	serverErr := httpServer.ListenAndServe()
	if serverErr != nil && !errors.Is(serverErr, http.ErrServerClosed) {
		l.Fatal("http server failed", "error", serverErr)
	}
	l.Info("http server stopped", "address", httpServer.Addr)

	<-ctx.Done()
	l.Info("received shutdown signal")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	l.Info("shutting down http server...", "address", httpServer.Addr)
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		l.Error("http server shutdown failed", "error", err)
	} else {
		l.Info("http_server shutdown completed")
	}

	<-shutdownCtx.Done()
	l.Warn("timeout waiting for http server to finish")

	l.Info("application shutdown completed")
}
