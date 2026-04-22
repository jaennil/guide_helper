ALTER TABLE routes
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS source_route_id UUID REFERENCES routes(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS version_group_id UUID,
ADD COLUMN IF NOT EXISTS version_number INTEGER;

UPDATE routes
SET version_group_id = id
WHERE version_group_id IS NULL;

UPDATE routes
SET version_number = 1
WHERE version_number IS NULL;

ALTER TABLE routes
ALTER COLUMN version_group_id SET NOT NULL,
ALTER COLUMN version_number SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_routes_source_route_id ON routes(source_route_id);
CREATE INDEX IF NOT EXISTS idx_routes_version_group_id ON routes(version_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_version_group_number
    ON routes(version_group_id, version_number);
