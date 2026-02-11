package cache

import (
	"sync"

	"github.com/jaennil/guide_helper/backend/cache/pkg/logger"
)

type MapCache struct {
	m      *TypedSyncMap
	logger logger.Logger
}


type TypedSyncMap struct {
	m sync.Map
}

func (c *TypedSyncMap) Load(k TileCacheKey) (TileCacheValue, bool) {
	v, exists :=  c.m.Load(k)
	if !exists {
		return nil, false
	}
	return v.(TileCacheValue), exists
}

func (c *TypedSyncMap) Store(k TileCacheKey, v TileCacheValue) {
	c.m.Store(k, v)
}

func NewMapCache(l logger.Logger) *MapCache {
	return &MapCache{
		m:      &TypedSyncMap{},
		logger: l,
	}
}

var _ TileCache = (*MapCache)(nil)

func (c *MapCache) Get(k TileCacheKey) (TileCacheValue, bool, error) {
	v, exists := c.m.Load(k)
	c.logger.Debug("map cache get", "z", k.Z, "x", k.X, "y", k.Y, "hit", exists)
	return v, exists, nil
}

func (c *MapCache) Set(k TileCacheKey, v TileCacheValue) error {
	c.logger.Debug("map cache set", "z", k.Z, "x", k.X, "y", k.Y)
	c.m.Store(k, v)
	return nil
}
