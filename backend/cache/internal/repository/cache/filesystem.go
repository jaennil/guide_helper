package cache

import (
	"fmt"
	"io/ioutil"
	"os"

	"github.com/jaennil/guide_helper/backend/cache/pkg/logger"
)

type FilesystemCache struct {
	logger logger.Logger
}

var _ TileCache = (*FilesystemCache)(nil)

func (c *FilesystemCache) Get(k TileCacheKey) (TileCacheValue, bool, error) {
	strKey := c.keyToString(k)
	c.logger.Debug("filesystem cache get", "path", strKey)
	content, err := ioutil.ReadFile(strKey)
	if err != nil {
		c.logger.Error("filesystem cache get failed", "path", strKey, "error", err)
		return nil, false, err
	}

	return content, true, nil
}

func (c *FilesystemCache) Set(k TileCacheKey, v TileCacheValue) error {
	strKey := c.keyToString(k)
	c.logger.Debug("filesystem cache set", "path", strKey)
	if err := os.WriteFile(strKey, v, 0644); err != nil {
		c.logger.Error("filesystem cache set failed", "path", strKey, "error", err)
		return err
	}
	return nil
}

func (c *FilesystemCache) keyToString(k TileCacheKey) string {
	return fmt.Sprintf("%d/%d/%d", k.Z, k.X, k.Y)
}
