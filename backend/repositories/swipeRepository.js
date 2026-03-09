const pool = require('../db/pool');

// Insert a new swipe. Returns the inserted row, or null if duplicate (ON CONFLICT DO NOTHING).
async function insert({ swiperId, targetId, action }, client = pool) {
  const result = await client.query(
    `INSERT INTO swipes (swiper_id, target_id, action)
     VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT uq_swipes_swiper_target DO NOTHING
     RETURNING id, swiper_id, target_id, action, created_at`,
    [swiperId, targetId, action]
  );
  return result.rows[0] || null; // null means duplicate
}

// Check if a reverse positive swipe exists (for match detection).
// Returns the swipe row if target has liked/superliked swiper, else null.
async function findReversePositiveSwipe({ swiperId, targetId }, client = pool) {
  const result = await client.query(
    `SELECT id FROM swipes
     WHERE swiper_id = $1
       AND target_id = $2
       AND action IN ('like', 'superlike')
     LIMIT 1`,
    [targetId, swiperId]  // note: reversed — we look for target→swiper
  );
  return result.rows[0] || null;
}

// Count today's super likes for a user (UTC day boundary).
async function countTodaySuperLikes(swiperId, client = pool) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS used
     FROM swipes
     WHERE swiper_id = $1
       AND action = 'superlike'
       AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
    [swiperId]
  );
  return result.rows[0].used;
}

// Check if a swipe already exists between this pair (any action).
async function findExisting({ swiperId, targetId }, client = pool) {
  const result = await client.query(
    'SELECT id, action FROM swipes WHERE swiper_id = $1 AND target_id = $2 LIMIT 1',
    [swiperId, targetId]
  );
  return result.rows[0] || null;
}

module.exports = { insert, findReversePositiveSwipe, countTodaySuperLikes, findExisting };
