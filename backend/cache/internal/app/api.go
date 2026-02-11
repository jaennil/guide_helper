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
	"github.com/jaennil/guide_helper/backend/cache/pkg/telemetry"
)

func Run(cfg *config.Config) {
	l := logger.NewZapLogger(cfg.Logger)

	l.Info("app config", "cfg", cfg)

	ctx := context.TODO()

	ctx = logger.WithLogger(ctx, l)

	// Initialize OpenTelemetry if enabled
	var shutdownTelemetry func(context.Context) error
	if cfg.Telemetry.Enabled {
		var err error
		shutdownTelemetry, err = telemetry.InitTracer(telemetry.Config{
			ServiceName:    cfg.Telemetry.ServiceName,
			ServiceVersion: cfg.Telemetry.ServiceVersion,
			Environment:    cfg.Telemetry.Environment,
			OTLPEndpoint:   cfg.Telemetry.OTLPEndpoint,
		}, l)
		if err != nil {
			l.Fatal("failed to initialize telemetry", "error", err)
		}
		defer func() {
			if err := shutdownTelemetry(context.Background()); err != nil {
				l.Error("failed to shutdown telemetry", "error", err)
			}
		}()
		l.Info("telemetry initialized", "service", cfg.Telemetry.ServiceName)
	}

	// Initialize the cache repository
	var tileCache cache.TileCache
	if cfg.Redis.Enabled {
		l.Info("initializing Redis cache", "addr", cfg.Redis.Addr)
		redisCache, err := cache.NewRedisCache(cache.RedisConfig{
			Addr:     cfg.Redis.Addr,
			Password: cfg.Redis.Password,
			DB:       cfg.Redis.DB,
			TTL:      cfg.Redis.TTL,
		}, l)
		if err != nil {
			l.Fatal("failed to initialize Redis cache", "error", err)
		}
		tileCache = redisCache
		l.Info("Redis cache initialized successfully")
	} else {
		l.Info("initializing SQLite in-memory cache")
		sqliteCache, err := cache.NewSQLiteCache("file:cache.db?cache=shared&mode=memory", l)
		if err != nil {
			l.Fatal("failed to initialize SQLite cache", "error", err)
		}
		tileCache = sqliteCache
		l.Info("SQLite cache initialized successfully")
	}

	// Initialize the use case
	tileCacheUseCase := usecase.NewTileCacheUseCase(tileCache, l)

	// Initialize the HTTP handler
	validate := validator.New()
	handler := handler.NewHandler(validate, tileCacheUseCase)
	router := v1.NewRouter(handler, l, cfg.Telemetry.Enabled)

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
