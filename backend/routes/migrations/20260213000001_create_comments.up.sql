CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    author_name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_comments_route_id ON comments(route_id);
CREATE INDEX idx_comments_route_id_created_at ON comments(route_id, created_at);
