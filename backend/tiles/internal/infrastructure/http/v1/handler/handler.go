package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jaennil/guide_helper/backend/tiles/internal/usecase"
)

type Handler struct {
	tileUseCase *usecase.TileUseCase
}

func NewHandler(uc *usecase.TileUseCase) *Handler {
	return &Handler{
		tileUseCase: uc,
	}
}

func (h *Handler) Healthz(c *gin.Context) {
	c.String(http.StatusOK, "OK")
}
