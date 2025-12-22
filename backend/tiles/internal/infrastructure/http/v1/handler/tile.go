package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jaennil/guide_helper/backend/tiles/pkg/logger"
)

func (h *Handler) Tile(c *gin.Context) {
	log, _ := c.Get("logger")
	l := log.(logger.Logger)

	strX := c.Param("x")
	strY := c.Param("y")
	strZ := c.Param("z")

	x, err := strconv.Atoi(strX)
	if err != nil {
		l.Warn("invalid x parameter", "x", strX, "error", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "x should be integer",
		})
		return
	}

	y, err := strconv.Atoi(strY)
	if err != nil {
		l.Warn("invalid y parameter", "y", strY, "error", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "y should be integer",
		})
		return
	}

	z, err := strconv.Atoi(strZ)
	if err != nil {
		l.Warn("invalid z parameter", "z", strZ, "error", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "z should be integer",
		})
		return
	}

	l.Info("tile request", "z", z, "x", x, "y", y)

	tileData, err := h.tileUseCase.GetTile(z, x, y)
	if err != nil {
		l.Error("failed to get tile", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to get tile",
		})
		return
	}

	// Return PNG image
	c.Data(http.StatusOK, "image/png", tileData)
}
