CREATE TABLE IF NOT EXISTS route_likes (
    id UUID PRIMARY KEY,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX idx_route_likes_route_user ON route_likes(route_id, user_id);
CREATE INDEX idx_route_likes_route_id ON route_likes(route_id);
