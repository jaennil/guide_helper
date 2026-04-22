DROP INDEX IF EXISTS idx_routes_version_group_number;
DROP INDEX IF EXISTS idx_routes_version_group_id;
DROP INDEX IF EXISTS idx_routes_source_route_id;

ALTER TABLE routes
DROP COLUMN IF EXISTS version_number,
DROP COLUMN IF EXISTS version_group_id,
DROP COLUMN IF EXISTS source_route_id,
DROP COLUMN IF EXISTS is_draft;
