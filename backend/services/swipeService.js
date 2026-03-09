const pool = require('../db/pool');
const userRepository = require('../repositories/userRepository');
const swipeRepository = require('../repositories/swipeRepository');
const matchRepository = require('../repositories/matchRepository');
const quotaService = require('./quotaService');

const VALID_ACTIONS = ['like', 'nope', 'superlike'];

function makeError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

async function recordSwipe({ swiperId, targetId, action }) {
  // --- Input validation ---
  if (!VALID_ACTIONS.includes(action)) {
    throw makeError('INVALID_REQUEST', `action must be one of: ${VALID_ACTIONS.join(', ')}`);
  }
  if (swiperId === targetId) {
    throw makeError('FORBIDDEN', 'Cannot swipe on yourself', 403);
  }

  // --- Validate target user exists ---
  const targetUser = await userRepository.findById(targetId);
  if (!targetUser) {
    throw makeError('USER_NOT_FOUND', 'Target user not found', 404);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // --- Super like quota check (inside transaction for consistency) ---
    let quotaStatus = null;
    if (action === 'superlike') {
      quotaStatus = await quotaService.assertQuotaAvailable(swiperId, client);
    }

    // --- Insert swipe ---
    const swipe = await swipeRepository.insert({ swiperId, targetId, action }, client);

    if (!swipe) {
      // Duplicate swipe — UNIQUE constraint fired
      await client.query('ROLLBACK');
      throw makeError('DUPLICATE_SWIPE', 'You have already swiped on this user', 409);
    }

    // --- Match detection (only for positive actions) ---
    let matched = false;
    let matchId = null;

    if (action === 'like' || action === 'superlike') {
      const reverseSwipe = await swipeRepository.findReversePositiveSwipe(
        { swiperId, targetId },
        client
      );

      if (reverseSwipe) {
        const match = await matchRepository.insertOrIgnore({ userAId: swiperId, userBId: targetId }, client);
        matched = true;
        matchId = match.id;
      }
    }

    await client.query('COMMIT');

    // Compute remaining quota for superlike responses
    const quotaRemaining = action === 'superlike'
      ? (quotaStatus ? quotaStatus.remaining - 1 : null)
      : null;

    return {
      swipeId: swipe.id,
      action: swipe.action,
      matched,
      matchId,
      quotaRemaining,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordSwipe };
