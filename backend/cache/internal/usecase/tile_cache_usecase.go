package usecase

import "github.com/jaennil/guide_helper/backend/cache/internal/repository/cache"

type TileCacheUseCase struct {
	cache cache.TileCache
}

func NewTileCacheUseCase(cache cache.TileCache) *TileCacheUseCase {
	return &TileCacheUseCase {
		cache: cache,
	}
}

func (uc *TileCacheUseCase) CacheTile(x, y, z int, data []byte) error {
	key := cache.TileCacheKey {
		X: x,
		Y: y,
		Z: z,
	}
	return uc.cache.Set(key, data)
}

func (uc *TileCacheUseCase) GetCachedTile(x, y, z int) ([]byte, bool, error) {
	key := cache.TileCacheKey {
		X: x,
		Y: y,
		Z: z,
	}

	return uc.cache.Get(key)
}
