package cache

import "sync"

type MapCache struct {
	m *TypedSyncMap
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

func NewMapCache() *MapCache {
	return &MapCache {
		m: &TypedSyncMap{},
	}
}

var _ TileCache = (*MapCache)(nil)

func (c *MapCache) Get(k TileCacheKey) (TileCacheValue, bool, error) {
	v, exists := c.m.Load(k)
	return v, exists, nil
}

func (c *MapCache) Set(k TileCacheKey, v TileCacheValue) error {
	c.m.Store(k, v)
	return nil
}
