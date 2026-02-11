package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/jaennil/guide_helper/backend/cache/pkg/logger"
	"github.com/jaennil/guide_helper/backend/cache/pkg/metrics"
	"github.com/redis/go-redis/v9"
)

type RedisCache struct {
	client *redis.Client
	ttl    time.Duration
	logger logger.Logger
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
	TTL      time.Duration
}

func NewRedisCache(cfg RedisConfig, l logger.Logger) (*RedisCache, error) {
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

	cache := &RedisCache{
		client: client,
		ttl:    ttl,
		logger: l,
	}

	// Start pool stats collector
	go cache.collectPoolStats()

	return cache, nil
}

var _ TileCache = (*RedisCache)(nil)

func (c *RedisCache) keyFor(k TileCacheKey) string {
	return fmt.Sprintf("tile:%d:%d:%d", k.Z, k.X, k.Y)
}

func (c *RedisCache) Get(k TileCacheKey) (TileCacheValue, bool, error) {
	start := time.Now()
	ctx := context.Background()
	key := c.keyFor(k)

	c.logger.Debug("redis cache get", "key", key)

	data, err := c.client.Get(ctx, key).Bytes()
	duration := time.Since(start).Seconds()
	metrics.RedisOperationDuration.WithLabelValues("get").Observe(duration)

	if err != nil {
		if err == redis.Nil {
			return nil, false, nil
		}
		metrics.RedisErrors.WithLabelValues("get").Inc()
		c.logger.Error("redis cache get failed", "key", key, "error", err)
		return nil, false, fmt.Errorf("redis get error: %w", err)
	}

	return data, true, nil
}

func (c *RedisCache) Set(k TileCacheKey, v TileCacheValue) error {
	start := time.Now()
	ctx := context.Background()
	key := c.keyFor(k)

	c.logger.Debug("redis cache set", "key", key)

	// Cast TileCacheValue to []byte for redis
	err := c.client.Set(ctx, key, []byte(v), c.ttl).Err()
	duration := time.Since(start).Seconds()
	metrics.RedisOperationDuration.WithLabelValues("set").Observe(duration)

	if err != nil {
		metrics.RedisErrors.WithLabelValues("set").Inc()
		c.logger.Error("redis cache set failed", "key", key, "error", err)
		return fmt.Errorf("redis set error: %w", err)
	}

	return nil
}

func (c *RedisCache) Close() error {
	c.logger.Info("redis connection closed")
	return c.client.Close()
}

func (c *RedisCache) collectPoolStats() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		stats := c.client.PoolStats()
		metrics.RedisPoolStats.WithLabelValues("hits").Set(float64(stats.Hits))
		metrics.RedisPoolStats.WithLabelValues("misses").Set(float64(stats.Misses))
		metrics.RedisPoolStats.WithLabelValues("timeouts").Set(float64(stats.Timeouts))
		metrics.RedisPoolStats.WithLabelValues("total_conns").Set(float64(stats.TotalConns))
		metrics.RedisPoolStats.WithLabelValues("idle_conns").Set(float64(stats.IdleConns))
		metrics.RedisPoolStats.WithLabelValues("stale_conns").Set(float64(stats.StaleConns))
	}
}
