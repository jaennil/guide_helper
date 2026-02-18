CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categories (id, name) VALUES
    (gen_random_uuid(), 'hiking'),
    (gen_random_uuid(), 'cycling'),
    (gen_random_uuid(), 'historical'),
    (gen_random_uuid(), 'nature'),
    (gen_random_uuid(), 'urban')
ON CONFLICT (name) DO NOTHING;
