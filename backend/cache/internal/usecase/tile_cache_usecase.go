package usecase

import (
	"github.com/jaennil/guide_helper/backend/cache/internal/repository/cache"
	"github.com/jaennil/guide_helper/backend/cache/pkg/logger"
)

type TileCacheUseCase struct {
	cache  cache.TileCache
	logger logger.Logger
}

func NewTileCacheUseCase(cache cache.TileCache, l logger.Logger) *TileCacheUseCase {
	return &TileCacheUseCase{
		cache:  cache,
		logger: l,
	}
}

func (uc *TileCacheUseCase) CacheTile(x, y, z int, data []byte) error {
	uc.logger.Debug("caching tile", "z", z, "x", x, "y", y, "size", len(data))
	key := cache.TileCacheKey{
		X: x,
		Y: y,
		Z: z,
	}
	if err := uc.cache.Set(key, data); err != nil {
		uc.logger.Error("failed to cache tile", "z", z, "x", x, "y", y, "error", err)
		return err
	}
	return nil
}

func (uc *TileCacheUseCase) GetCachedTile(x, y, z int) ([]byte, bool, error) {
	uc.logger.Debug("cache lookup", "z", z, "x", x, "y", y)
	key := cache.TileCacheKey{
		X: x,
		Y: y,
		Z: z,
	}

	data, exists, err := uc.cache.Get(key)
	if err != nil {
		uc.logger.Error("cache lookup failed", "z", z, "x", x, "y", y, "error", err)
		return nil, false, err
	}
	return data, exists, nil
}
