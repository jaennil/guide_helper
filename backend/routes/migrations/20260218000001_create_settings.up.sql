CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES (
    'difficulty_thresholds',
    '{"distance_easy_max_km": 5.0, "distance_moderate_max_km": 15.0, "elevation_easy_max_m": 300.0, "elevation_moderate_max_m": 800.0, "score_easy_max": 3, "score_moderate_max": 4}'::jsonb
) ON CONFLICT (key) DO NOTHING;
