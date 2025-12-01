package dto

type TileCacheResponse struct {
	Data []byte `json:"data"`
	Exists bool `json:"exists"`
}
