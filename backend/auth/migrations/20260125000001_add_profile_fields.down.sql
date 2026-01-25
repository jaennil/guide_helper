-- Remove profile fields from users table
ALTER TABLE users
DROP COLUMN name,
DROP COLUMN avatar_url;
