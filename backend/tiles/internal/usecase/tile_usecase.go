package usecase

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jaennil/guide_helper/backend/tiles/pkg/logger"
)

type TileUseCase struct {
	cacheBaseURL      string
	upstreamTileURL   string
	httpClient        *http.Client
	logger            logger.Logger
}

func NewTileUseCase(cacheBaseURL, upstreamTileURL string, logger logger.Logger) *TileUseCase {
	return &TileUseCase{
		cacheBaseURL:    cacheBaseURL,
		upstreamTileURL: upstreamTileURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		logger: logger,
	}
}

func (uc *TileUseCase) GetTile(z, x, y int) ([]byte, error) {
	// Try to get from cache first
	cacheURL := fmt.Sprintf("%s/api/v1/tile/%d/%d/%d", uc.cacheBaseURL, z, x, y)
	uc.logger.Debug("checking cache", "url", cacheURL)

	resp, err := uc.httpClient.Get(cacheURL)
	if err != nil {
		uc.logger.Warn("failed to check cache", "error", err)
	} else {
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			// Parse response to check if tile exists
			// For now, we'll fetch the tile data regardless
			// TODO: Parse JSON response to check "exists" field
			uc.logger.Info("tile may be in cache, checking...")
		}
	}

	// Fetch from upstream
	upstreamURL := fmt.Sprintf("%s/%d/%d/%d.png", uc.upstreamTileURL, z, x, y)
	uc.logger.Info("fetching from upstream", "url", upstreamURL)

	resp, err = uc.httpClient.Get(upstreamURL)
	if err != nil {
		uc.logger.Error("failed to fetch from upstream", "error", err)
		return nil, fmt.Errorf("failed to fetch tile from upstream: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		uc.logger.Error("upstream returned non-200", "status", resp.StatusCode)
		return nil, fmt.Errorf("upstream returned status %d", resp.StatusCode)
	}

	tileData, err := io.ReadAll(resp.Body)
	if err != nil {
		uc.logger.Error("failed to read tile data", "error", err)
		return nil, fmt.Errorf("failed to read tile data: %w", err)
	}

	uc.logger.Info("fetched tile from upstream", "size", len(tileData))

	// Store in cache (fire and forget)
	go func() {
		if err := uc.storeTileInCache(z, x, y, tileData); err != nil {
			uc.logger.Warn("failed to store tile in cache", "error", err)
		}
	}()

	return tileData, nil
}

func (uc *TileUseCase) storeTileInCache(z, x, y int, data []byte) error {
	cacheURL := fmt.Sprintf("%s/api/v1/tile/%d/%d/%d", uc.cacheBaseURL, z, x, y)
	uc.logger.Debug("storing in cache", "url", cacheURL)

	req, err := http.NewRequest(http.MethodPost, cacheURL, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")

	resp, err := uc.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to store in cache: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("cache returned status %d", resp.StatusCode)
	}

	uc.logger.Info("stored tile in cache", "z", z, "x", x, "y", y)
	return nil
}
