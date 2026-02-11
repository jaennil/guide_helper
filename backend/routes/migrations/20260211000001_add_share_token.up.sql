ALTER TABLE routes ADD COLUMN share_token UUID DEFAULT NULL;
CREATE UNIQUE INDEX idx_routes_share_token ON routes(share_token) WHERE share_token IS NOT NULL;
