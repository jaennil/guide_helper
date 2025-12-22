package handler

import (
	"net/http"
	"strconv"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/jaennil/guide_helper/backend/cache/internal/infrastructure/http/v1/dto"
	"github.com/jaennil/guide_helper/backend/cache/pkg/logger"
	"github.com/jaennil/guide_helper/backend/cache/pkg/metrics"
)

var cache sync.Map

func (h *Handler) Tile(c *gin.Context) {
	log, _ := c.Get("logger")
	l := log.(*logger.ZapLogger)

	strX := c.Param("x")
	strY := c.Param("y")
	strZ := c.Param("z")

	x, err := strconv.Atoi(strX)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H {
			"error": "x should be integer",
		})
		return
	}

	y, err := strconv.Atoi(strY)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H {
			"error": "y should be integer",
		})
		return
	}

	z, err := strconv.Atoi(strZ)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H {
			"error": "z should be integer",
		})
		return
	}

	data, exists, err := h.tileCacheUseCase.GetCachedTile(x, y, z)
	if err != nil {
		h.RespondWithInternalServerError(c)
		return
	}

	if exists {
		l.Info("returned cached tile")
		metrics.CacheHits.Inc()
	} else {
		metrics.CacheMisses.Inc()
	}

	resp := dto.TileCacheResponse {
		Data: data,
		Exists: exists,
	}

	h.RespondWithJSON(c, http.StatusOK, "got tile", resp)
}

func (h *Handler) StoreTile(c *gin.Context) {
	log, _ := c.Get("logger")
	l := log.(*logger.ZapLogger)

	strX := c.Param("x")
	strY := c.Param("y")
	strZ := c.Param("z")

	x, err := strconv.Atoi(strX)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "x should be integer",
		})
		return
	}

	y, err := strconv.Atoi(strY)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "y should be integer",
		})
		return
	}

	z, err := strconv.Atoi(strZ)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "z should be integer",
		})
		return
	}

	// Read tile data from request body
	tileData, err := c.GetRawData()
	if err != nil || len(tileData) == 0 {
		l.Warn("invalid tile data", "error", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid tile data",
		})
		return
	}

	l.Info("storing tile", "z", z, "x", x, "y", y, "size", len(tileData))

	err = h.tileCacheUseCase.CacheTile(x, y, z, tileData)
	if err != nil {
		l.Error("failed to cache tile", "error", err)
		h.RespondWithInternalServerError(c)
		return
	}

	metrics.CacheStores.Inc()
	h.RespondWithJSON(c, http.StatusOK, "tile stored", nil)
}

