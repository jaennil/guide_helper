-- Cleanup script for records created by seed_500_records.sql.
-- Run with:
--   psql postgresql://authuser:authpass123@localhost:5433/auth_db -f testdata/demo-db/cleanup_demo_records.sql

\set ON_ERROR_STOP on

\connect routes_db

DELETE FROM settings
WHERE key = 'demo_dataset';

DELETE FROM chat_messages
WHERE id::text IN (
    SELECT (
        substr(md5('guide-helper-demo-chat-message-' || n), 1, 8) || '-' ||
        substr(md5('guide-helper-demo-chat-message-' || n), 9, 4) || '-' ||
        substr(md5('guide-helper-demo-chat-message-' || n), 13, 4) || '-' ||
        substr(md5('guide-helper-demo-chat-message-' || n), 17, 4) || '-' ||
        substr(md5('guide-helper-demo-chat-message-' || n), 21, 12)
    )
    FROM generate_series(1, 40) AS n
);

DELETE FROM notifications
WHERE id::text IN (
    SELECT (
        substr(md5('guide-helper-demo-notification-' || n), 1, 8) || '-' ||
        substr(md5('guide-helper-demo-notification-' || n), 9, 4) || '-' ||
        substr(md5('guide-helper-demo-notification-' || n), 13, 4) || '-' ||
        substr(md5('guide-helper-demo-notification-' || n), 17, 4) || '-' ||
        substr(md5('guide-helper-demo-notification-' || n), 21, 12)
    )
    FROM generate_series(1, 60) AS n
);

DELETE FROM route_bookmarks
WHERE id::text IN (
    SELECT (
        substr(md5('guide-helper-demo-bookmark-' || n), 1, 8) || '-' ||
        substr(md5('guide-helper-demo-bookmark-' || n), 9, 4) || '-' ||
        substr(md5('guide-helper-demo-bookmark-' || n), 13, 4) || '-' ||
        substr(md5('guide-helper-demo-bookmark-' || n), 17, 4) || '-' ||
        substr(md5('guide-helper-demo-bookmark-' || n), 21, 12)
    )
    FROM generate_series(1, 60) AS n
);

DELETE FROM route_ratings
WHERE id::text IN (
    SELECT (
        substr(md5('guide-helper-demo-rating-' || n), 1, 8) || '-' ||
        substr(md5('guide-helper-demo-rating-' || n), 9, 4) || '-' ||
        substr(md5('guide-helper-demo-rating-' || n), 13, 4) || '-' ||
        substr(md5('guide-helper-demo-rating-' || n), 17, 4) || '-' ||
        substr(md5('guide-helper-demo-rating-' || n), 21, 12)
    )
    FROM generate_series(1, 80) AS n
);

DELETE FROM route_likes
WHERE id::text IN (
    SELECT (
        substr(md5('guide-helper-demo-like-' || n), 1, 8) || '-' ||
        substr(md5('guide-helper-demo-like-' || n), 9, 4) || '-' ||
        substr(md5('guide-helper-demo-like-' || n), 13, 4) || '-' ||
        substr(md5('guide-helper-demo-like-' || n), 17, 4) || '-' ||
        substr(md5('guide-helper-demo-like-' || n), 21, 12)
    )
    FROM generate_series(1, 120) AS n
);

DELETE FROM comments
WHERE id::text IN (
    SELECT (
        substr(md5('guide-helper-demo-comment-' || n), 1, 8) || '-' ||
        substr(md5('guide-helper-demo-comment-' || n), 9, 4) || '-' ||
        substr(md5('guide-helper-demo-comment-' || n), 13, 4) || '-' ||
        substr(md5('guide-helper-demo-comment-' || n), 17, 4) || '-' ||
        substr(md5('guide-helper-demo-comment-' || n), 21, 12)
    )
    FROM generate_series(1, 160) AS n
);

DELETE FROM routes
WHERE name LIKE 'Демо-маршрут %'
  AND description = 'Демонстрационный маршрут для проверки каталога, публикации, социальных функций и геопривязанных фотографий.';

\connect auth_db

DELETE FROM users
WHERE email LIKE 'demo-user-%@guide-helper.local';
