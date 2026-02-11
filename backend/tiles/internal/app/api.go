package app

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	v1 "github.com/jaennil/guide_helper/backend/tiles/internal/infrastructure/http/v1"
	"github.com/jaennil/guide_helper/backend/tiles/internal/infrastructure/http/v1/handler"
	"github.com/jaennil/guide_helper/backend/tiles/internal/usecase"
	"github.com/jaennil/guide_helper/backend/tiles/pkg/config"
	"github.com/jaennil/guide_helper/backend/tiles/pkg/logger"
	"github.com/jaennil/guide_helper/backend/tiles/pkg/telemetry"
)

func Run() {
	// Load config
	cfg, err := config.New()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Initialize logger
	l := logger.NewZapLogger(cfg.Logger.Level)

	l.Info("starting tiles service", "config", cfg)

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

	// Initialize usecase
	tileUseCase := usecase.NewTileUseCase(
		cfg.Cache.BaseURL,
		cfg.Upstream.TileServerURL,
		l,
	)

	// Initialize handler
	h := handler.NewHandler(tileUseCase)

	// Initialize router
	router := v1.NewRouter(h, l, cfg.Telemetry.Enabled)

	// Initialize HTTP server
	server := &http.Server{
		Addr:         ":" + cfg.HTTP.Server.Port,
		Handler:      router,
		ReadTimeout:  cfg.HTTP.Server.ReadTimeout,
		WriteTimeout: cfg.HTTP.Server.WriteTimeout,
		IdleTimeout:  cfg.HTTP.Server.IdleTimeout,
	}

	// Start server
	go func() {
		l.Info("starting http server", "port", cfg.HTTP.Server.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			l.Fatal("failed to start server", "error", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	l.Info("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		l.Fatal("server forced to shutdown", "error", err)
	}

	l.Info("server stopped")
}
