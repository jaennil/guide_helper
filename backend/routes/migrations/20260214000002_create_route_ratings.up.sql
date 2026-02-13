CREATE TABLE IF NOT EXISTS route_ratings (
    id UUID PRIMARY KEY,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX idx_route_ratings_route_user ON route_ratings(route_id, user_id);
CREATE INDEX idx_route_ratings_route_id ON route_ratings(route_id);
