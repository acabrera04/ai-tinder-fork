-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- users table
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- swipes table
-- UNIQUE(swiper_id, target_id) is the DB-level concurrency guard against duplicate swipes
CREATE TABLE IF NOT EXISTS swipes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  swiper_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL CHECK (action IN ('like', 'nope', 'superlike')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_swipes_swiper_target UNIQUE (swiper_id, target_id),
  CONSTRAINT chk_no_self_swipe CHECK (swiper_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_swipes_target_swiper ON swipes(target_id, swiper_id) WHERE action IN ('like', 'superlike');
CREATE INDEX IF NOT EXISTS idx_swipes_swiper_id ON swipes(swiper_id);
CREATE INDEX IF NOT EXISTS idx_swipes_quota ON swipes(swiper_id, action, created_at) WHERE action = 'superlike';

-- matches table
-- Canonical ordering: user1_id < user2_id (lexicographic UUID sort)
-- The CHECK constraint + UNIQUE prevents both (A,B) and (B,A) duplicates
CREATE TABLE IF NOT EXISTS matches (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_matches_users UNIQUE (user1_id, user2_id),
  CONSTRAINT chk_matches_ordered CHECK (user1_id < user2_id),
  CONSTRAINT chk_no_self_match CHECK (user1_id <> user2_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);
CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);
