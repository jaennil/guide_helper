package cache

import (
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
)

const (
	smallTileSize  = 1024      // 1KB
	mediumTileSize = 10 * 1024 // 10KB
	largeTileSize  = 50 * 1024 // 50KB
)

func generateTileData(size int) []byte {
	data := make([]byte, size)
	rand.Read(data)
	return data
}

func generateRandomKey() TileCacheKey {
	return TileCacheKey{
		X: rand.Intn(1000),
		Y: rand.Intn(1000),
		Z: rand.Intn(20),
	}
}

func setupSQLiteCache(b *testing.B) (*SQLiteCache, func()) {
	b.Helper()
	tmpFile := filepath.Join(b.TempDir(), "test.db")
	cache, err := NewSQLiteCache(tmpFile)
	if err != nil {
		b.Fatalf("Failed to create SQLite cache: %v", err)
	}
	return cache, func() {
		cache.db.Close()
		os.Remove(tmpFile)
	}
}

func setupMapCache(b *testing.B) (*MapCache, func()) {
	b.Helper()
	return NewMapCache(), func() {}
}

func setupFilesystemCache(b *testing.B) (*FilesystemCache, func()) {
	b.Helper()
	tmpDir := b.TempDir()

	// Create directory structure for filesystem cache
	for z := 0; z < 20; z++ {
		for x := 0; x < 1000; x++ {
			dirPath := filepath.Join(tmpDir, fmt.Sprintf("%d/%d", z, x))
			if err := os.MkdirAll(dirPath, 0755); err != nil {
				b.Fatalf("Failed to create directory: %v", err)
			}
		}
	}

	// Change to temp directory for relative paths
	oldDir, _ := os.Getwd()
	os.Chdir(tmpDir)

	return &FilesystemCache{}, func() {
		os.Chdir(oldDir)
	}
}

// Benchmark Set operations
func BenchmarkSet_SQLite_Small(b *testing.B) {
	cache, cleanup := setupSQLiteCache(b)
	defer cleanup()
	data := generateTileData(smallTileSize)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 1000, Y: i % 1000, Z: i % 20}
		if err := cache.Set(key, data); err != nil {
			b.Fatalf("Set failed: %v", err)
		}
	}
}

func BenchmarkSet_Map_Small(b *testing.B) {
	cache, cleanup := setupMapCache(b)
	defer cleanup()
	data := generateTileData(smallTileSize)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 1000, Y: i % 1000, Z: i % 20}
		if err := cache.Set(key, data); err != nil {
			b.Fatalf("Set failed: %v", err)
		}
	}
}

func BenchmarkSet_Filesystem_Small(b *testing.B) {
	cache, cleanup := setupFilesystemCache(b)
	defer cleanup()
	data := generateTileData(smallTileSize)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 1000, Y: i % 1000, Z: i % 20}
		if err := cache.Set(key, data); err != nil {
			b.Fatalf("Set failed: %v", err)
		}
	}
}

func BenchmarkSet_SQLite_Large(b *testing.B) {
	cache, cleanup := setupSQLiteCache(b)
	defer cleanup()
	data := generateTileData(largeTileSize)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 1000, Y: i % 1000, Z: i % 20}
		if err := cache.Set(key, data); err != nil {
			b.Fatalf("Set failed: %v", err)
		}
	}
}

func BenchmarkSet_Map_Large(b *testing.B) {
	cache, cleanup := setupMapCache(b)
	defer cleanup()
	data := generateTileData(largeTileSize)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 1000, Y: i % 1000, Z: i % 20}
		if err := cache.Set(key, data); err != nil {
			b.Fatalf("Set failed: %v", err)
		}
	}
}

func BenchmarkSet_Filesystem_Large(b *testing.B) {
	cache, cleanup := setupFilesystemCache(b)
	defer cleanup()
	data := generateTileData(largeTileSize)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 1000, Y: i % 1000, Z: i % 20}
		if err := cache.Set(key, data); err != nil {
			b.Fatalf("Set failed: %v", err)
		}
	}
}

// Benchmark Get operations
func BenchmarkGet_SQLite_Small(b *testing.B) {
	cache, cleanup := setupSQLiteCache(b)
	defer cleanup()
	data := generateTileData(smallTileSize)

	// Populate cache
	for i := 0; i < 100; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		_, _, err := cache.Get(key)
		if err != nil {
			b.Fatalf("Get failed: %v", err)
		}
	}
}

func BenchmarkGet_Map_Small(b *testing.B) {
	cache, cleanup := setupMapCache(b)
	defer cleanup()
	data := generateTileData(smallTileSize)

	// Populate cache
	for i := 0; i < 100; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		_, _, err := cache.Get(key)
		if err != nil {
			b.Fatalf("Get failed: %v", err)
		}
	}
}

func BenchmarkGet_Filesystem_Small(b *testing.B) {
	cache, cleanup := setupFilesystemCache(b)
	defer cleanup()
	data := generateTileData(smallTileSize)

	// Populate cache
	for i := 0; i < 100; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		_, _, err := cache.Get(key)
		if err != nil {
			b.Fatalf("Get failed: %v", err)
		}
	}
}

func BenchmarkGet_SQLite_Large(b *testing.B) {
	cache, cleanup := setupSQLiteCache(b)
	defer cleanup()
	data := generateTileData(largeTileSize)

	// Populate cache
	for i := 0; i < 100; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		_, _, err := cache.Get(key)
		if err != nil {
			b.Fatalf("Get failed: %v", err)
		}
	}
}

func BenchmarkGet_Map_Large(b *testing.B) {
	cache, cleanup := setupMapCache(b)
	defer cleanup()
	data := generateTileData(largeTileSize)

	// Populate cache
	for i := 0; i < 100; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		_, _, err := cache.Get(key)
		if err != nil {
			b.Fatalf("Get failed: %v", err)
		}
	}
}

func BenchmarkGet_Filesystem_Large(b *testing.B) {
	cache, cleanup := setupFilesystemCache(b)
	defer cleanup()
	data := generateTileData(largeTileSize)

	// Populate cache
	for i := 0; i < 100; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		_, _, err := cache.Get(key)
		if err != nil {
			b.Fatalf("Get failed: %v", err)
		}
	}
}

// Benchmark mixed operations (80% reads, 20% writes - typical cache pattern)
func BenchmarkMixed_SQLite(b *testing.B) {
	cache, cleanup := setupSQLiteCache(b)
	defer cleanup()
	data := generateTileData(mediumTileSize)

	// Pre-populate with some data
	for i := 0; i < 50; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		if i%5 == 0 {
			// 20% writes
			cache.Set(key, data)
		} else {
			// 80% reads
			cache.Get(key)
		}
	}
}

func BenchmarkMixed_Map(b *testing.B) {
	cache, cleanup := setupMapCache(b)
	defer cleanup()
	data := generateTileData(mediumTileSize)

	// Pre-populate with some data
	for i := 0; i < 50; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		if i%5 == 0 {
			// 20% writes
			cache.Set(key, data)
		} else {
			// 80% reads
			cache.Get(key)
		}
	}
}

func BenchmarkMixed_Filesystem(b *testing.B) {
	cache, cleanup := setupFilesystemCache(b)
	defer cleanup()
	data := generateTileData(mediumTileSize)

	// Pre-populate with some data
	for i := 0; i < 50; i++ {
		key := TileCacheKey{X: i, Y: i, Z: i % 20}
		cache.Set(key, data)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
		if i%5 == 0 {
			// 20% writes
			cache.Set(key, data)
		} else {
			// 80% reads
			cache.Get(key)
		}
	}
}

// Benchmark concurrent operations
func BenchmarkConcurrent_SQLite(b *testing.B) {
	cache, cleanup := setupSQLiteCache(b)
	defer cleanup()
	data := generateTileData(mediumTileSize)

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
			if i%5 == 0 {
				cache.Set(key, data)
			} else {
				cache.Get(key)
			}
			i++
		}
	})
}

func BenchmarkConcurrent_Map(b *testing.B) {
	cache, cleanup := setupMapCache(b)
	defer cleanup()
	data := generateTileData(mediumTileSize)

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
			if i%5 == 0 {
				cache.Set(key, data)
			} else {
				cache.Get(key)
			}
			i++
		}
	})
}

func BenchmarkConcurrent_Filesystem(b *testing.B) {
	cache, cleanup := setupFilesystemCache(b)
	defer cleanup()
	data := generateTileData(mediumTileSize)

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			key := TileCacheKey{X: i % 100, Y: i % 100, Z: i % 20}
			if i%5 == 0 {
				cache.Set(key, data)
			} else {
				cache.Get(key)
			}
			i++
		}
	})
}
