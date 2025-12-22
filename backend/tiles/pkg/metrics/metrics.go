package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	TilesRequests = promauto.NewCounter(prometheus.CounterOpts{
		Name: "tiles_requests_total",
		Help: "Total number of tile requests",
	})

	TilesCacheHits = promauto.NewCounter(prometheus.CounterOpts{
		Name: "tiles_cache_hits_total",
		Help: "Total number of cache hits in tiles service",
	})

	TilesCacheMisses = promauto.NewCounter(prometheus.CounterOpts{
		Name: "tiles_cache_misses_total",
		Help: "Total number of cache misses in tiles service",
	})

	TilesUpstreamRequests = promauto.NewCounter(prometheus.CounterOpts{
		Name: "tiles_upstream_requests_total",
		Help: "Total number of upstream (OSM) requests",
	})

	TilesUpstreamLatency = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "tiles_upstream_latency_seconds",
		Help:    "Latency of upstream tile fetches in seconds",
		Buckets: prometheus.DefBuckets,
	})
)
