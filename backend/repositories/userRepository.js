const pool = require('../db/pool');

async function findById(id) {
  const result = await pool.query('SELECT id, email, display_name, created_at FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByEmail(email) {
  const result = await pool.query('SELECT id, email, password_hash, display_name FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function create({ email, passwordHash, displayName }) {
  const result = await pool.query(
    'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name, created_at',
    [email, passwordHash, displayName || null]
  );
  return result.rows[0];
}

module.exports = { findById, findByEmail, create };
