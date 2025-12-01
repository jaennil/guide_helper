package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) Healthz(c *gin.Context) {
	c.JSON(http.StatusOK, "OK")
}
