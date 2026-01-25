package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	CacheHits = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cache_hits_total",
		Help: "Total number of cache hits",
	})

	CacheMisses = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cache_misses_total",
		Help: "Total number of cache misses",
	})

	CacheStores = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cache_stores_total",
		Help: "Total number of cache store operations",
	})

	// Redis metrics
	RedisOperationDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "redis_operation_duration_seconds",
		Help:    "Duration of Redis operations in seconds",
		Buckets: []float64{.0001, .0005, .001, .005, .01, .025, .05, .1, .25, .5, 1},
	}, []string{"operation"})

	RedisErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "redis_errors_total",
		Help: "Total number of Redis errors",
	}, []string{"operation"})

	RedisPoolStats = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "redis_pool_stats",
		Help: "Redis connection pool statistics",
	}, []string{"stat"})
)
