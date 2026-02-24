CREATE TABLE IF NOT EXISTS route_bookmarks (
    id UUID PRIMARY KEY,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX idx_route_bookmarks_route_user ON route_bookmarks(route_id, user_id);
CREATE INDEX idx_route_bookmarks_user_id ON route_bookmarks(user_id);
