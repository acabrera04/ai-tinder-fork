const express = require('express');
const authMiddleware = require('../middleware/auth');
const pushService = require('../services/pushService');

const router = express.Router();

// GET /api/push/vapid-key — public, no auth required
router.get('/vapid-key', (_req, res) => {
  const publicKey = pushService.getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({
      error: 'PUSH_NOT_CONFIGURED',
      message: 'Push notifications are not configured on this server',
    });
  }
  return res.json({ publicKey });
});

// POST /api/push/subscribe — save a push subscription (auth required)
router.post('/subscribe', authMiddleware, async (req, res) => {
  const { subscription } = req.body;

  if (!subscription || !subscription.endpoint || !subscription.keys ||
      !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'subscription with endpoint and keys (p256dh, auth) is required',
    });
  }

  try {
    await pushService.saveSubscription({ userId: req.userId, subscription });
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('push subscribe error', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to save subscription' });
  }
});

module.exports = router;
