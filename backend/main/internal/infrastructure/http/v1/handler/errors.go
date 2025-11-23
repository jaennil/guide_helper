package handler

import "errors"

var (
	ErrFailedToDecodeRequestBody = errors.New("failed to decode request body")
	InternalServerError          = errors.New("server encountered a problem and could not process your request")
)
