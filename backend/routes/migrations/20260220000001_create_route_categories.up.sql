CREATE TABLE route_categories (
    route_id    UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (route_id, category_id)
);

INSERT INTO route_categories (route_id, category_id)
SELECT r.id, c.id
FROM routes r
CROSS JOIN LATERAL unnest(r.tags) AS t(tag_name)
JOIN categories c ON c.name = t.tag_name
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS idx_routes_tags;
ALTER TABLE routes DROP COLUMN tags;
