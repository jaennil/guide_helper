package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisCache struct {
	client *redis.Client
	ttl    time.Duration
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
	TTL      time.Duration
}

func NewRedisCache(cfg RedisConfig) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	ttl := cfg.TTL
	if ttl == 0 {
		ttl = 24 * time.Hour // default TTL
	}

	return &RedisCache{
		client: client,
		ttl:    ttl,
	}, nil
}

var _ TileCache = (*RedisCache)(nil)

func (c *RedisCache) keyFor(k TileCacheKey) string {
	return fmt.Sprintf("tile:%d:%d:%d", k.Z, k.X, k.Y)
}

func (c *RedisCache) Get(k TileCacheKey) (TileCacheValue, bool, error) {
	ctx := context.Background()
	key := c.keyFor(k)

	data, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("redis get error: %w", err)
	}

	return data, true, nil
}

func (c *RedisCache) Set(k TileCacheKey, v TileCacheValue) error {
	ctx := context.Background()
	key := c.keyFor(k)

	// Cast TileCacheValue to []byte for redis
	if err := c.client.Set(ctx, key, []byte(v), c.ttl).Err(); err != nil {
		return fmt.Errorf("redis set error: %w", err)
	}

	return nil
}

func (c *RedisCache) Close() error {
	return c.client.Close()
}
