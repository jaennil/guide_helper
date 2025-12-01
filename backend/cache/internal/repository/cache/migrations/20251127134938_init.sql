-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS tile_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    z INTEGER NOT NULL,
    tile_data BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(x, y, z)
);

CREATE INDEX IF NOT EXISTS idx_tile_coords ON tile_cache(x, y, z);
CREATE INDEX IF NOT EXISTS idx_tile_created_at ON tile_cache(created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS tile_cache;
-- +goose StatementEnd
