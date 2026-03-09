const pool = require('../db/pool');

// Insert a match. Uses canonical ordering (user1_id < user2_id).
// Returns the match row, or the existing match if already exists (ON CONFLICT DO NOTHING).
async function insertOrIgnore({ userAId, userBId }, client = pool) {
  const [user1Id, user2Id] = [userAId, userBId].sort(); // lexicographic UUID sort
  const result = await client.query(
    `INSERT INTO matches (user1_id, user2_id)
     VALUES ($1, $2)
     ON CONFLICT ON CONSTRAINT uq_matches_users DO UPDATE SET created_at = matches.created_at
     RETURNING id, user1_id, user2_id, created_at`,
    [user1Id, user2Id]
  );
  return result.rows[0];
}

async function findByUsers({ userAId, userBId }, client = pool) {
  const [user1Id, user2Id] = [userAId, userBId].sort();
  const result = await client.query(
    'SELECT id, user1_id, user2_id, created_at FROM matches WHERE user1_id = $1 AND user2_id = $2',
    [user1Id, user2Id]
  );
  return result.rows[0] || null;
}

async function findAllForUser(userId) {
  const result = await pool.query(
    `SELECT id, user1_id, user2_id, created_at
     FROM matches
     WHERE user1_id = $1 OR user2_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

module.exports = { insertOrIgnore, findByUsers, findAllForUser };
