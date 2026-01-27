package v1

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jaennil/guide_helper/backend/tiles/internal/infrastructure/http/v1/handler"
	"github.com/jaennil/guide_helper/backend/tiles/pkg/logger"
	"github.com/jaennil/guide_helper/backend/tiles/pkg/telemetry"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func NewRouter(handler *handler.Handler, l logger.Logger, telemetryEnabled bool) *gin.Engine {
	r := gin.Default()

	r.Use(gin.Recovery())

	// Add OpenTelemetry middleware if enabled
	if telemetryEnabled {
		r.Use(telemetry.GinMiddleware("guide-helper-tiles"))
	}

	r.Use(ginZapLogger(l))

	api := r.Group("/api")
	v1 := api.Group("/v1")

	v1.GET("/healthz", handler.Healthz)
	v1.GET("/tile/:z/:x/:y", handler.Tile)

	// Prometheus metrics endpoint
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	return r
}

func ginZapLogger(l logger.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("logger", l)

		start := time.Now()

		c.Next()

		end := time.Now()
		latency := end.Sub(start)

		l.Info("request",
			"status", c.Writer.Status(),
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"ip", c.ClientIP(),
			"latency", latency,
			"size", c.Writer.Size(),
		)
	}
}
