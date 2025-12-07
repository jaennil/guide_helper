.PHONY: bench bench-set bench-get bench-mixed bench-concurrent bench-compare bench-all

# Run all benchmarks
bench:
	@echo "Running all cache benchmarks..."
	cd internal/repository/cache && go test -bench=. -benchmem -benchtime=3s

# Run only Set operation benchmarks
bench-set:
	@echo "Running Set operation benchmarks..."
	cd internal/repository/cache && go test -bench=BenchmarkSet -benchmem -benchtime=3s

# Run only Get operation benchmarks
bench-get:
	@echo "Running Get operation benchmarks..."
	cd internal/repository/cache && go test -bench=BenchmarkGet -benchmem -benchtime=3s

# Run only mixed operation benchmarks
bench-mixed:
	@echo "Running mixed operation benchmarks..."
	cd internal/repository/cache && go test -bench=BenchmarkMixed -benchmem -benchtime=3s

# Run only concurrent operation benchmarks
bench-concurrent:
	@echo "Running concurrent operation benchmarks..."
	cd internal/repository/cache && go test -bench=BenchmarkConcurrent -benchmem -benchtime=3s

# Run benchmarks and save results to file
bench-save:
	@echo "Running benchmarks and saving results..."
	cd internal/repository/cache && go test -bench=. -benchmem -benchtime=3s | tee benchmark_results.txt
	@echo ""
	@echo "Results saved to: internal/repository/cache/benchmark_results.txt"

# Compare benchmarks using benchstat (requires: go install golang.org/x/perf/cmd/benchstat@latest)
bench-compare:
	@echo "To compare benchmark results:"
	@echo "1. Run: make bench-save > old.txt"
	@echo "2. Make changes"
	@echo "3. Run: make bench-save > new.txt"
	@echo "4. Run: benchstat old.txt new.txt"

# Run benchmarks for a specific cache implementation
bench-sqlite:
	@echo "Running SQLite cache benchmarks..."
	cd internal/repository/cache && go test -bench=.*SQLite.* -benchmem -benchtime=3s

bench-map:
	@echo "Running Map cache benchmarks..."
	cd internal/repository/cache && go test -bench=.*Map.* -benchmem -benchtime=3s

bench-filesystem:
	@echo "Running Filesystem cache benchmarks..."
	cd internal/repository/cache && go test -bench=.*Filesystem.* -benchmem -benchtime=3s

# Quick benchmark with shorter run time
bench-quick:
	@echo "Running quick benchmarks..."
	cd internal/repository/cache && go test -bench=. -benchmem -benchtime=1s

# Help
help:
	@echo "Available benchmark targets:"
	@echo "  make bench            - Run all benchmarks"
	@echo "  make bench-set        - Run Set operation benchmarks"
	@echo "  make bench-get        - Run Get operation benchmarks"
	@echo "  make bench-mixed      - Run mixed operation benchmarks"
	@echo "  make bench-concurrent - Run concurrent operation benchmarks"
	@echo "  make bench-sqlite     - Run SQLite-specific benchmarks"
	@echo "  make bench-map        - Run Map-specific benchmarks"
	@echo "  make bench-filesystem - Run Filesystem-specific benchmarks"
	@echo "  make bench-save       - Run benchmarks and save to file"
	@echo "  make bench-quick      - Run quick benchmarks (1s each)"
