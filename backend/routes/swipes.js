const express = require('express');
const { validate: isUuid } = require('uuid');
const authMiddleware = require('../middleware/auth');
const { swipeLimiter } = require('../middleware/rateLimit');
const swipeService = require('../services/swipeService');
const quotaService = require('../services/quotaService');

const router = express.Router();

// All swipe routes require authentication
router.use(authMiddleware);

// GET /api/swipes/quota  — returns today's super like quota status
router.get('/quota', async (req, res) => {
  try {
    const status = await quotaService.getQuotaStatus(req.userId);
    return res.json(status);
  } catch (err) {
    console.error('quota error', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch quota' });
  }
});

// POST /api/swipes  — record a like, nope, or superlike
router.post('/', swipeLimiter, async (req, res) => {
  try {
    const { targetUserId, action } = req.body;

    // Validate request body
    if (!targetUserId || !action) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'targetUserId and action are required',
      });
    }
    if (!isUuid(targetUserId)) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'targetUserId must be a valid UUID',
      });
    }
    if (!['like', 'nope', 'superlike'].includes(action)) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'action must be one of: like, nope, superlike',
      });
    }

    const result = await swipeService.recordSwipe({
      swiperId: req.userId,
      targetId: targetUserId,
      action,
    });

    return res.status(201).json(result);
  } catch (err) {
    // Map service errors to HTTP responses
    if (err.code === 'QUOTA_EXCEEDED') {
      return res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message: err.message,
        quotaRemaining: 0,
        resetsAt: err.quotaStatus?.resetsAt,
      });
    }
    if (err.code === 'DUPLICATE_SWIPE') {
      return res.status(409).json({ error: 'DUPLICATE_SWIPE', message: err.message });
    }
    if (err.code === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'USER_NOT_FOUND', message: err.message });
    }
    if (err.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: err.message });
    }
    if (err.code === 'INVALID_REQUEST') {
      return res.status(400).json({ error: 'INVALID_REQUEST', message: err.message });
    }
    console.error('swipe error', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  }
});

module.exports = router;
