package cache

import (
	"fmt"
	"io/ioutil"
	"os"
)

type FilesystemCache struct {

}

var _ TileCache = (*FilesystemCache)(nil)

func (c *FilesystemCache) Get(k TileCacheKey) (TileCacheValue, bool, error) {
	strKey := c.keyToString(k)
	content, err := ioutil.ReadFile(strKey)
	if err != nil {
		return nil, false, err
	}

	return content, true, nil
}

func (c *FilesystemCache) Set(k TileCacheKey, v TileCacheValue) error {
	strKey := c.keyToString(k)
	return os.WriteFile(strKey, v, 0644)
}

func (c *FilesystemCache) keyToString(k TileCacheKey) string {
	return fmt.Sprintf("%d/%d/%d", k.Z, k.X, k.Y)
}
