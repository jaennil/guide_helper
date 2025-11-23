package v1

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jaennil/guide_helper/main/internal/infrastructure/http/v1/handler"
	"github.com/jaennil/guide_helper/main/pkg/logger"
)

func NewRouter(handler *handler.Handler, l logger.Logger) *gin.Engine {
	r := gin.Default()

	r.Use(gin.Recovery())
	r.Use(ginZapLogger(l))

	api := r.Group("/api")
	v1 := api.Group("/v1")

	v1.GET("/heathz", handler.Healthz)
	v1.GET("/tile/:z/:x/:y", handler.Tile)

	return r
}

func ginZapLogger(l logger.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("logger", l)

		// if c.Request.URL.Path == "/healthz" {
		// 	c.Next()
		// 	return
		// }

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
