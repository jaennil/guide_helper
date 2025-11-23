package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-playground/validator/v10"
	"github.com/jaennil/guide_helper/main/pkg/logger"
)

type Handler struct {
	validate *validator.Validate
}

func NewHandler(validator *validator.Validate) *Handler {
	return &Handler {
		validate: validator,
	}
}

func (h *Handler) RespondWithInternalServerError(w http.ResponseWriter, r *http.Request, err error) {
	ctx := r.Context()
	l := logger.FromContext(ctx)

	l.Error("internal http_server error",
		"method", r.Method,
		"path", r.URL.Path,
		"user_agent", r.UserAgent(),
		"ip", r.RemoteAddr,
		"error", err,
	)

	h.RespondWithError(w, http.StatusInternalServerError, InternalServerError)
}

func (h *Handler) RespondWithJSON(w http.ResponseWriter, r *http.Request, code int, message string, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)

	success := code < 400

	j, err := json.Marshal(response{success, message, data})
	if err != nil {
		h.RespondWithInternalServerError(w, r, err)
		return
	}

	_, err = w.Write(j)
	if err != nil {
		h.RespondWithInternalServerError(w, r, err)
		return
	}
}

func (h *Handler) RespondWithError(w http.ResponseWriter, code int, err error) {
	h.RespondWithJSON(w, nil, code, err.Error(), nil)
}

func (h *Handler) RespondWithErrorWithRequest(w http.ResponseWriter, r *http.Request, code int, err error) {
	if code >= 500 && r != nil {
		ctx := r.Context()
		l := logger.FromContext(ctx)
		l.Error("http_server error",
			"method", r.Method,
			"path", r.URL.Path,
			"status", code,
			"error", err,
		)
	}
	h.RespondWithJSON(w, r, code, err.Error(), nil)
}
