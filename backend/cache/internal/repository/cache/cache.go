package cache

type TileCacheKey struct {
	X int
	Y int
	Z int
}

type TileCacheValue []byte


type TileCache interface {
	Get(TileCacheKey) (TileCacheValue, bool, error)
	Set(TileCacheKey, TileCacheValue) error
}
