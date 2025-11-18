package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var (
	cache  sync.Map
	logger *zap.Logger
)

func main() {
	// Initialize Zap logger
	initLogger()
	defer logger.Sync()

	// Disable Gin's default logger
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	// Add Zap logger middleware
	r.Use(ginZapLogger())

	r.GET("/healthz", healthz)
	r.GET("/tile/:z/:x/:y", tile)
	r.GET("/cache/stats", cacheStats)

	// Serve attribution on root path
	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, `OpenStreetMap Tiles Proxy
		
Attribution Required: 
© OpenStreetMap contributors - https://www.openstreetmap.org/copyright

This service proxies tiles from OpenStreetMap. Please ensure proper attribution in your application.`)
	})

	logger.Info("Server starting on :8080")
	if err := r.Run(); err != nil {
		logger.Fatal("Failed to start server", zap.Error(err))
	}
}

func initLogger() {
	config := zap.NewDevelopmentConfig()
	
	// Customize for better readability
	config.EncoderConfig.TimeKey = "time"
	config.EncoderConfig.EncodeTime = zapcore.TimeEncoderOfLayout("15:04:05.000")
	config.EncoderConfig.LevelKey = "level"
	config.EncoderConfig.MessageKey = "msg"
	config.EncoderConfig.CallerKey = "" // Disable caller for cleaner output
	config.EncoderConfig.NameKey = ""

	// Use console encoder for development readability
	config.Encoding = "console"
	config.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	
	// Set log level
	config.Level = zap.NewAtomicLevelAt(zap.DebugLevel)
	
	// Build logger
	var err error
	logger, err = config.Build()
	if err != nil {
		panic(fmt.Sprintf("Failed to initialize logger: %v", err))
	}
}

// ginZapLogger returns a gin middleware that logs requests using Zap
func ginZapLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip logging for health checks
		if c.Request.URL.Path == "/healthz" {
			c.Next()
			return
		}

		start := time.Now()
		
		// Process request
		c.Next()
		
		end := time.Now()
		latency := end.Sub(start)

		// Log the request
		logger.Info("request",
			zap.Int("status", c.Writer.Status()),
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.String("ip", c.ClientIP()),
			zap.Duration("latency", latency),
			zap.Int("size", c.Writer.Size()),
		)
	}
}

func healthz(c *gin.Context) {
	logger.Debug("Health check requested")
	c.JSON(http.StatusOK, "OK")
}

func tile(c *gin.Context) {
	z := c.Param("z")
	x := c.Param("x")
	y := c.Param("y")

	id := fmt.Sprintf("%s/%s/%s", z, x, y)
	url := fmt.Sprintf("https://tile.openstreetmap.org/%s/%s/%s.png", z, x, y)

	// Try to get from cache first
	if cachedData, exists := cache.Load(id); exists {
		data := cachedData.([]byte)
		
		// Set headers for cached response
		c.Header("Content-Type", "image/png")
		c.Header("Content-Length", fmt.Sprintf("%d", len(data)))
		c.Header("Cache-Control", "public, max-age=604800")
		c.Header("X-OpenStreetMap-Attribution", "© OpenStreetMap contributors")
		c.Header("X-Tile-Source", "cache")
		
		// Write cached data
		c.Writer.Write(data)
		
		logger.Debug("tile from cache",
			zap.String("tile", id),
			zap.Int("size", len(data)),
		)
		return
	}

	// Not in cache, fetch from OpenStreetMap
	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		logger.Error("failed to create request",
			zap.String("tile", id),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to create request",
		})
		return
	}

	// Set required headers for OpenStreetMap
	req.Header.Set("User-Agent", "MyGinTileProxy/1.0 (https://myapp.com)")
	req.Header.Set("Referer", "https://myapp.com")

	// Execute request
	startTime := time.Now()
	resp, err := client.Do(req)
	requestDuration := time.Since(startTime)

	if err != nil {
		logger.Error("failed to fetch tile",
			zap.String("tile", id),
			zap.Duration("duration", requestDuration),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to fetch tile from openstreetmap: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.Warn("tile not found",
			zap.String("tile", id),
			zap.Int("status", resp.StatusCode),
			zap.Duration("duration", requestDuration),
		)
		c.JSON(resp.StatusCode, gin.H{
			"error": fmt.Sprintf("OpenStreetMap API returned: %s", resp.Status),
		})
		return
	}

	logger.Info("fetched tile",
		zap.String("tile", id),
		zap.Int("status", resp.StatusCode),
		zap.Duration("duration", requestDuration),
		zap.String("content_length", resp.Header.Get("Content-Length")),
	)

	// Use a buffer to capture the response while streaming
	var buf bytes.Buffer
	tee := io.TeeReader(resp.Body, &buf)

	// Set headers
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png"
	}
	
	contentLength := resp.Header.Get("Content-Length")
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", contentLength)
	
	// Cache headers
	cacheControl := resp.Header.Get("Cache-Control")
	if cacheControl == "" {
		cacheControl = "public, max-age=604800"
	}
	c.Header("Cache-Control", cacheControl)
	c.Header("X-OpenStreetMap-Attribution", "© OpenStreetMap contributors")
	c.Header("X-Tile-Source", "network")

	// Stream to client and cache simultaneously
	_, err = io.Copy(c.Writer, tee)
	if err != nil {
		logger.Error("failed to stream tile",
			zap.String("tile", id),
			zap.Error(err),
		)
		return
	}

	// Store in cache after successful streaming
	cacheData := buf.Bytes()
	cache.Store(id, cacheData)

	logger.Info("cached tile",
		zap.String("tile", id),
		zap.Int("size", len(cacheData)),
		zap.Duration("total_duration", time.Since(startTime)),
	)
}

func getCacheStats() map[string]interface{} {
	count := 0
	totalSize := 0
	
	cache.Range(func(key, value interface{}) bool {
		count++
		if data, ok := value.([]byte); ok {
			totalSize += len(data)
		}
		return true
	})
	
	return map[string]interface{}{
		"tile_count":       count,
		"total_size_bytes": totalSize,
		"total_size_mb":    float64(totalSize) / (1024 * 1024),
	}
}

func cacheStats(c *gin.Context) {
	stats := getCacheStats()
	logger.Info("cache statistics", zap.Any("stats", stats))
	c.JSON(http.StatusOK, stats)
}
