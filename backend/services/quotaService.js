const swipeRepository = require('../repositories/swipeRepository');

const DAILY_QUOTA = parseInt(process.env.SUPERLIKE_DAILY_QUOTA || '5', 10);

async function getQuotaStatus(userId, client = undefined) {
  const used = await swipeRepository.countTodaySuperLikes(userId, client);
  const remaining = Math.max(0, DAILY_QUOTA - used);
  // Reset at next UTC midnight
  const now = new Date();
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { used, remaining, total: DAILY_QUOTA, resetsAt };
}

async function assertQuotaAvailable(userId, client = undefined) {
  const status = await getQuotaStatus(userId, client);
  if (status.remaining <= 0) {
    const err = new Error('Super like quota exhausted for today.');
    err.code = 'QUOTA_EXCEEDED';
    err.quotaStatus = status;
    throw err;
  }
  return status;
}

module.exports = { getQuotaStatus, assertQuotaAvailable, DAILY_QUOTA };
