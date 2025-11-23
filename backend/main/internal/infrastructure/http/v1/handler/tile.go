package handler

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jaennil/guide_helper/main/pkg/logger"
)

var cache sync.Map

func (h *Handler) Tile(c *gin.Context) {
	log, _ := c.Get("logger")
	l := log.(*logger.ZapLogger)

	z := c.Param("z")
	x := c.Param("x")
	y := c.Param("y")

	id := fmt.Sprintf("%s/%s/%s", z, x, y)
	url := fmt.Sprintf("https://tile.openstreetmap.org/%s/%s/%s.png", z, x, y)

	if cachedData, exists := cache.Load(id); exists {
		data := cachedData.([]byte)
		
		c.Header("Content-Type", "image/png")
		c.Header("Content-Length", fmt.Sprintf("%d", len(data)))
		c.Header("Cache-Control", "public, max-age=604800")
		c.Header("X-OpenStreetMap-Attribution", "© OpenStreetMap contributors")
		c.Header("X-Tile-Source", "cache")
		
		c.Writer.Write(data)
		
		l.Debug("tile from cache",
			"tile", id,
			"size", len(data),
		)
		return
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		l.Error("failed to create request",
			"tile", id,
			"error", err,
		)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to create request",
		})
		return
	}

	req.Header.Set("User-Agent", "MyGinTileProxy/1.0 (https://myapp.com)")
	req.Header.Set("Referer", "https://myapp.com")

	startTime := time.Now()
	resp, err := client.Do(req)
	requestDuration := time.Since(startTime)

	if err != nil {
		l.Error("failed to fetch tile",
			"tile", id,
			"duration", requestDuration,
			"error", err,
		)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to fetch tile from openstreetmap: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		l.Warn("tile not found",
			"tile", id,
			"status", resp.StatusCode,
			"duration", requestDuration,
		)
		c.JSON(resp.StatusCode, gin.H{
			"error": fmt.Sprintf("OpenStreetMap API returned: %s", resp.Status),
		})
		return
	}

	l.Info("fetched tile",
		"tile", id,
		"status", resp.StatusCode,
		"duration", requestDuration,
		"content_length", resp.Header.Get("Content-Length"),
	)

	var buf bytes.Buffer
	tee := io.TeeReader(resp.Body, &buf)

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png"
	}
	
	contentLength := resp.Header.Get("Content-Length")
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", contentLength)
	
	cacheControl := resp.Header.Get("Cache-Control")
	if cacheControl == "" {
		cacheControl = "public, max-age=604800"
	}
	c.Header("Cache-Control", cacheControl)
	c.Header("X-OpenStreetMap-Attribution", "© OpenStreetMap contributors")
	c.Header("X-Tile-Source", "network")

	_, err = io.Copy(c.Writer, tee)
	if err != nil {
		l.Error("failed to stream tile",
			"tile", id,
			err,
		)
		return
	}

	cacheData := buf.Bytes()
	cache.Store(id, cacheData)

	l.Info("cached tile",
		"tile", id,
		"size", len(cacheData),
		"total_duration", time.Since(startTime),
	)
}
