# Demo database dataset

This directory contains reproducible data for a diploma defense/demo stand.

The seed is intentionally not a production migration. It creates deterministic
records in the existing `auth_db` and `routes_db` schema so the system can be
shown with a populated catalog, social activity, notifications and AI chat
history.

Run after applying service migrations:

```bash
psql postgresql://authuser:authpass123@localhost:5433/auth_db \
  -f testdata/demo-db/seed_500_records.sql
```

Remove the dataset:

```bash
psql postgresql://authuser:authpass123@localhost:5433/auth_db \
  -f testdata/demo-db/cleanup_demo_records.sql
```

Check demo counters:

```bash
psql postgresql://authuser:authpass123@localhost:5433/auth_db \
  -f testdata/demo-db/count_demo_records.sql
```

The seed inserts at least 720 non-cross-table records:

- 40 demo users;
- 160 routes with georeferenced points and optional photo metadata;
- 160 comments;
- 120 likes;
- 80 ratings;
- 60 bookmarks;
- 60 notifications;
- 40 chat messages.

`route_categories` rows are created too, but they are deliberately not counted
because the diploma methodology excludes cross tables from the 500-record
threshold.
