-- Add profile fields to users table
ALTER TABLE users
ADD COLUMN name TEXT,
ADD COLUMN avatar_url TEXT;
