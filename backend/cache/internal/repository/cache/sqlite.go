package cache

import (
	"database/sql"
	_ "embed"

	"github.com/jaennil/guide_helper/backend/cache/pkg/logger"
	_ "github.com/mattn/go-sqlite3"
	"github.com/pressly/goose/v3"
)

type SQLiteCache struct {
	db     *sql.DB
	logger logger.Logger
}

func NewSQLiteCache(path string, l logger.Logger) (*SQLiteCache, error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, err
	}

	err = db.Ping()
	if err != nil {
		return nil, err
	}

	c := &SQLiteCache{
		db:     db,
		logger: l,
	}

	err = c.runMigrations()
	if err != nil {
		return nil, err
	}

	l.Info("sqlite cache initialized", "path", path)

	return c, nil
}

func (c *SQLiteCache) runMigrations() error {
	goose.SetBaseFS(migrations)

	err := goose.SetDialect("sqlite3")
	if err != nil {
		return err
	}

	err = goose.Up(c.db, "migrations")
	if err != nil {
		return err
	}

	return nil
}

var _ TileCache = (*SQLiteCache)(nil)

func (c *SQLiteCache) Get(k TileCacheKey) (TileCacheValue, bool, error) {
	c.logger.Debug("sqlite cache get", "z", k.Z, "x", k.X, "y", k.Y)

	query := `SELECT tile_data
	FROM tile_cache
	WHERE x = ? AND y = ? AND z = ?`

	var tileData []byte
	err := c.db.QueryRow(query, k.X, k.Y, k.Z).Scan(&tileData)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, false, nil
		}
		c.logger.Error("sqlite cache get failed", "z", k.Z, "x", k.X, "y", k.Y, "error", err)
		return nil, false, err
	}

	return tileData, true, nil
}

func (c *SQLiteCache) Set(k TileCacheKey, v TileCacheValue) error {
	c.logger.Debug("sqlite cache set", "z", k.Z, "x", k.X, "y", k.Y)

	query := `INSERT INTO tile_cache (x, y, z, tile_data)
	VALUES (?, ?, ?, ?)
	ON CONFLICT(x, y, z) DO UPDATE SET tile_data = excluded.tile_data`

	_, err := c.db.Exec(query, k.X, k.Y, k.Z, v)
	if err != nil {
		c.logger.Error("sqlite cache set failed", "z", k.Z, "x", k.X, "y", k.Y, "error", err)
		return err
	}

	return nil
}
