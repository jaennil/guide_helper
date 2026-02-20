ALTER TABLE routes ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';

UPDATE routes r
SET tags = (
    SELECT COALESCE(ARRAY_AGG(c.name), '{}')
    FROM route_categories rc
    JOIN categories c ON c.id = rc.category_id
    WHERE rc.route_id = r.id
);

DROP TABLE IF EXISTS route_categories;
