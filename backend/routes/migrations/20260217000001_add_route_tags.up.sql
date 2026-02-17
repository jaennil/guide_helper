ALTER TABLE routes ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_routes_tags ON routes USING GIN (tags);
