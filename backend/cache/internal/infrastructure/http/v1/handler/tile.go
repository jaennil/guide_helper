package handler

import (
	"net/http"
	"strconv"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/jaennil/guide_helper/backend/cache/internal/infrastructure/http/v1/dto"
	"github.com/jaennil/guide_helper/backend/cache/pkg/logger"
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
	}

	resp := dto.TileCacheResponse {
		Data: data,
		Exists: exists,
	}

	h.RespondWithJSON(c, http.StatusOK, "got tile", resp)
}
