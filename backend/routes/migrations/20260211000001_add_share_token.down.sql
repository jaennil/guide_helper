DROP INDEX IF EXISTS idx_routes_share_token;
ALTER TABLE routes DROP COLUMN IF EXISTS share_token;
