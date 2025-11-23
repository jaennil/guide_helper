package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-playground/validator/v10"
	v1 "github.com/jaennil/guide_helper/main/internal/infrastructure/http/v1"
	"github.com/jaennil/guide_helper/main/internal/infrastructure/http/v1/handler"
	"github.com/jaennil/guide_helper/main/pkg/config"
	"github.com/jaennil/guide_helper/main/pkg/http_server"
	"github.com/jaennil/guide_helper/main/pkg/logger"
)

func Run(cfg *config.Config) {
	l := logger.NewZapLogger(cfg.Logger)

	l.Info("app config", "cfg", cfg)

	ctx := context.TODO()
	
	ctx = logger.WithLogger(ctx, l)

	validate := validator.New()
	handler := handler.NewHandler(validate)
	router := v1.NewRouter(handler, l)

	httpServer := http_server.NewServer(ctx, cfg.HTTP.Server, router)

	l.Info("starting http server...", "address", httpServer.Addr)

	err := httpServer.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		l.Fatal("http server failed", "error", err)
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
