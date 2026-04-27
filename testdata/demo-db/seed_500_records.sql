-- Reproducible demo dataset for the Guide Helper defense stand.
-- Run with psql after applying auth and routes service migrations:
--   psql postgresql://authuser:authpass123@localhost:5433/auth_db -f testdata/demo-db/seed_500_records.sql
--
-- The script is intentionally outside production migrations. It creates more than
-- 500 domain records for demonstration and diploma requirement verification.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.demo_uuid(seed text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (
        substr(md5(seed), 1, 8) || '-' ||
        substr(md5(seed), 9, 4) || '-' ||
        substr(md5(seed), 13, 4) || '-' ||
        substr(md5(seed), 17, 4) || '-' ||
        substr(md5(seed), 21, 12)
    )::uuid
$$;

INSERT INTO users (id, email, password_hash, name, avatar_url, role, created_at, updated_at)
SELECT
    pg_temp.demo_uuid('guide-helper-demo-user-' || n),
    'demo-user-' || lpad(n::text, 3, '0') || '@guide-helper.local',
    'demo-password-hash-not-for-login',
    CASE
        WHEN n % 10 = 0 THEN 'Администратор демо ' || n
        WHEN n % 5 = 0 THEN 'Модератор демо ' || n
        ELSE 'Пользователь демо ' || n
    END,
    NULL,
    CASE
        WHEN n % 10 = 0 THEN 'admin'
        WHEN n % 5 = 0 THEN 'moderator'
        ELSE 'user'
    END,
    now() - (n || ' days')::interval,
    now() - (n || ' hours')::interval
FROM generate_series(1, 40) AS n
ON CONFLICT (email) DO NOTHING;

\connect routes_db

CREATE OR REPLACE FUNCTION pg_temp.demo_uuid(seed text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (
        substr(md5(seed), 1, 8) || '-' ||
        substr(md5(seed), 9, 4) || '-' ||
        substr(md5(seed), 13, 4) || '-' ||
        substr(md5(seed), 17, 4) || '-' ||
        substr(md5(seed), 21, 12)
    )::uuid
$$;

INSERT INTO categories (id, name)
VALUES
    (pg_temp.demo_uuid('demo-category-hiking'), 'hiking'),
    (pg_temp.demo_uuid('demo-category-cycling'), 'cycling'),
    (pg_temp.demo_uuid('demo-category-historical'), 'historical'),
    (pg_temp.demo_uuid('demo-category-nature'), 'nature'),
    (pg_temp.demo_uuid('demo-category-urban'), 'urban')
ON CONFLICT (name) DO NOTHING;

WITH generated_routes AS (
    SELECT
        n,
        pg_temp.demo_uuid('guide-helper-demo-route-' || n) AS route_id,
        pg_temp.demo_uuid('guide-helper-demo-user-' || ((n - 1) % 40 + 1)) AS owner_id,
        55.60 + ((n % 30)::numeric * 0.006) AS start_lat,
        37.35 + ((n % 25)::numeric * 0.007) AS start_lng,
        55.61 + ((n % 30)::numeric * 0.006) AS end_lat,
        37.37 + ((n % 25)::numeric * 0.007) AS end_lng
    FROM generate_series(1, 160) AS n
)
INSERT INTO routes (
    id,
    user_id,
    name,
    points,
    created_at,
    updated_at,
    share_token,
    start_location,
    end_location,
    seasons,
    description,
    line_color,
    started_at,
    is_draft,
    version_group_id,
    version_number
)
SELECT
    route_id,
    owner_id,
    'Демо-маршрут ' || lpad(n::text, 3, '0'),
    jsonb_build_array(
        jsonb_build_object(
            'id', 'point-' || n || '-1',
            'lat', start_lat,
            'lng', start_lng,
            'note', 'Стартовая точка демонстрационного маршрута',
            'photo', CASE WHEN n % 3 = 0 THEN jsonb_build_object(
                'status', 'done',
                'url', '/photos/demo/demo-route-' || n || '-1.jpg',
                'thumbnailUrl', '/photos/demo/thumb-demo-route-' || n || '-1.jpg'
            ) ELSE NULL END
        ),
        jsonb_build_object(
            'id', 'point-' || n || '-2',
            'lat', end_lat,
            'lng', end_lng,
            'note', 'Финишная точка с описанием места',
            'photo', CASE WHEN n % 4 = 0 THEN jsonb_build_object(
                'status', 'done',
                'url', '/photos/demo/demo-route-' || n || '-2.jpg',
                'thumbnailUrl', '/photos/demo/thumb-demo-route-' || n || '-2.jpg'
            ) ELSE NULL END
        )
    ),
    now() - (n || ' days')::interval,
    now() - (n || ' hours')::interval,
    pg_temp.demo_uuid('guide-helper-demo-share-' || n),
    CASE WHEN n % 2 = 0 THEN 'Москва' ELSE 'Московская область' END,
    CASE WHEN n % 3 = 0 THEN 'Исторический центр' ELSE 'Парк и набережная' END,
    ARRAY[
        CASE (n % 4)
            WHEN 0 THEN 'spring'
            WHEN 1 THEN 'summer'
            WHEN 2 THEN 'autumn'
            ELSE 'winter'
        END
    ],
    'Демонстрационный маршрут для проверки каталога, публикации, социальных функций и геопривязанных фотографий.',
    CASE (n % 8)
        WHEN 0 THEN '#3b82f6'
        WHEN 1 THEN '#22c55e'
        WHEN 2 THEN '#f59e0b'
        WHEN 3 THEN '#ef4444'
        WHEN 4 THEN '#8b5cf6'
        WHEN 5 THEN '#14b8a6'
        WHEN 6 THEN '#f97316'
        ELSE '#ec4899'
    END,
    now() - (n || ' days')::interval,
    FALSE,
    route_id,
    1
FROM generated_routes
ON CONFLICT (id) DO NOTHING;

WITH demo_routes AS (
    SELECT id, row_number() OVER (ORDER BY name) AS n
    FROM routes
    WHERE name LIKE 'Демо-маршрут %'
),
demo_categories AS (
    SELECT id, row_number() OVER (ORDER BY name) AS n
    FROM categories
    WHERE name IN ('hiking', 'cycling', 'historical', 'nature', 'urban')
)
INSERT INTO route_categories (route_id, category_id)
SELECT r.id, c.id
FROM demo_routes r
JOIN demo_categories c ON c.n = ((r.n - 1) % 5 + 1)
ON CONFLICT DO NOTHING;

WITH demo_routes AS (
    SELECT id, row_number() OVER (ORDER BY name) AS n
    FROM routes
    WHERE name LIKE 'Демо-маршрут %'
)
INSERT INTO comments (id, route_id, user_id, author_name, text, created_at)
SELECT
    pg_temp.demo_uuid('guide-helper-demo-comment-' || n),
    id,
    pg_temp.demo_uuid('guide-helper-demo-user-' || ((n + 7) % 40 + 1)),
    'Демо-комментатор ' || ((n + 7) % 40 + 1),
    'Маршрут подходит для демонстрации пользовательского сценария № ' || n || '.',
    now() - (n || ' hours')::interval
FROM demo_routes
WHERE n <= 160
ON CONFLICT (id) DO NOTHING;

WITH demo_routes AS (
    SELECT id, row_number() OVER (ORDER BY name) AS n
    FROM routes
    WHERE name LIKE 'Демо-маршрут %'
)
INSERT INTO route_likes (id, route_id, user_id, created_at)
SELECT
    pg_temp.demo_uuid('guide-helper-demo-like-' || n),
    id,
    pg_temp.demo_uuid('guide-helper-demo-user-' || ((n + 13) % 40 + 1)),
    now() - (n || ' minutes')::interval
FROM demo_routes
WHERE n <= 120
ON CONFLICT (route_id, user_id) DO NOTHING;

WITH demo_routes AS (
    SELECT id, row_number() OVER (ORDER BY name) AS n
    FROM routes
    WHERE name LIKE 'Демо-маршрут %'
)
INSERT INTO route_ratings (id, route_id, user_id, rating, created_at)
SELECT
    pg_temp.demo_uuid('guide-helper-demo-rating-' || n),
    id,
    pg_temp.demo_uuid('guide-helper-demo-user-' || ((n + 19) % 40 + 1)),
    ((n - 1) % 5 + 1)::smallint,
    now() - (n || ' minutes')::interval
FROM demo_routes
WHERE n <= 80
ON CONFLICT (route_id, user_id) DO NOTHING;

WITH demo_routes AS (
    SELECT id, row_number() OVER (ORDER BY name) AS n
    FROM routes
    WHERE name LIKE 'Демо-маршрут %'
)
INSERT INTO route_bookmarks (id, route_id, user_id, created_at)
SELECT
    pg_temp.demo_uuid('guide-helper-demo-bookmark-' || n),
    id,
    pg_temp.demo_uuid('guide-helper-demo-user-' || ((n + 23) % 40 + 1)),
    now() - (n || ' minutes')::interval
FROM demo_routes
WHERE n <= 60
ON CONFLICT (route_id, user_id) DO NOTHING;

WITH demo_routes AS (
    SELECT id, row_number() OVER (ORDER BY name) AS n
    FROM routes
    WHERE name LIKE 'Демо-маршрут %'
)
INSERT INTO notifications (id, user_id, notification_type, route_id, actor_name, message, is_read, created_at)
SELECT
    pg_temp.demo_uuid('guide-helper-demo-notification-' || n),
    pg_temp.demo_uuid('guide-helper-demo-user-' || ((n - 1) % 40 + 1)),
    CASE WHEN n % 3 = 0 THEN 'comment' WHEN n % 3 = 1 THEN 'like' ELSE 'rating' END,
    id,
    'Демо-пользователь ' || ((n + 5) % 40 + 1),
    'Демонстрационное уведомление по маршруту № ' || n,
    n % 4 = 0,
    now() - (n || ' minutes')::interval
FROM demo_routes
WHERE n <= 60
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_messages (id, user_id, conversation_id, role, content, actions, created_at)
SELECT
    pg_temp.demo_uuid('guide-helper-demo-chat-message-' || n),
    pg_temp.demo_uuid('guide-helper-demo-user-' || ((n - 1) % 40 + 1)),
    pg_temp.demo_uuid('guide-helper-demo-chat-conversation-' || ((n - 1) / 2 + 1)),
    CASE WHEN n % 2 = 1 THEN 'user' ELSE 'assistant' END,
    CASE WHEN n % 2 = 1
        THEN 'Найди интересный маршрут рядом с центром города'
        ELSE 'Подобран демонстрационный маршрут с геопривязанными фотографиями'
    END,
    CASE WHEN n % 2 = 0
        THEN jsonb_build_array(jsonb_build_object('type', 'show_route', 'route_name', 'Демо-маршрут'))
        ELSE NULL
    END,
    now() - (n || ' minutes')::interval
FROM generate_series(1, 40) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (key, value)
VALUES (
    'demo_dataset',
    jsonb_build_object(
        'users', 40,
        'routes', 160,
        'comments', 160,
        'likes', 120,
        'ratings', 80,
        'bookmarks', 60,
        'notifications', 60,
        'chat_messages', 40,
        'total_without_cross_tables', 720,
        'seed_file', 'testdata/demo-db/seed_500_records.sql'
    )
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
