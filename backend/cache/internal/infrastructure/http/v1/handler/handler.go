package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/jaennil/guide_helper/backend/cache/internal/usecase"
)

const (
	internalServerErrorText = "the server encountered an error and could not process your request"
)

type response struct {
	Success bool `json:"success"`
	Message string `json:"message"`
	Data any `json:"data,omitempty"`
}


type Handler struct {
	validate *validator.Validate
	tileCacheUseCase *usecase.TileCacheUseCase
}

func NewHandler(v *validator.Validate, uc *usecase.TileCacheUseCase) *Handler {
	return &Handler {
		validate: v,
		tileCacheUseCase: uc,
	}
}

func (h *Handler) RespondWithInternalServerError(c *gin.Context) {
	h.RespondWithJSON(c, http.StatusInternalServerError, internalServerErrorText, nil)
}

func (h *Handler) RespondWithJSON(c *gin.Context, code int, message string, data any) {
	success := code < 400

	r := response {
		Success: success,
		Message: message,
		Data: data,
	}

	c.JSON(code, r)
}
