const express = require('express');
const { RejectService, validateRejectRequest } = require('../services/RejectService');
const { authenticateToken, userRateLimit } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize service
const rejectService = new RejectService();

// All routes require authentication
router.use(authenticateToken);

// Reject a profile
router.post('/', validateRejectRequest, userRateLimit(60 * 1000, 20), async (req, res) => {
  try {
    const { profileId, mlFeatures } = req.body;
    const userId = req.userId;

    const result = await rejectService.rejectProfile(userId, profileId, mlFeatures);

    logger.info(`User ${userId} rejected profile ${profileId}`);
    res.json(result);

  } catch (error) {
    logger.error('Error rejecting profile:', error);
    
    if (error.message.includes('Rate limit')) {
      return res.status(429).json({ error: error.message });
    }
    
    if (error.message.includes('already rejected')) {
      return res.status(409).json({ error: error.message });
    }
    
    if (error.message.includes('not found') || error.message.includes('active')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to reject profile' });
  }
});

// Check if user has rejected a profile
router.get('/check/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params;
    const userId = req.userId;

    const hasRejected = await rejectService.checkIfRejected(userId, profileId);
    
    res.json({ hasRejected });

  } catch (error) {
    logger.error('Error checking reject status:', error);
    res.status(500).json({ error: 'Failed to check reject status' });
  }
});

// Get user's rejected profiles
router.get('/my-rejects', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const userId = req.userId;

    const profiles = await rejectService.getRejectedProfiles(userId, page, limit);
    
    res.json({
      profiles,
      page,
      limit,
      hasMore: profiles.length === limit
    });

  } catch (error) {
    logger.error('Error getting rejected profiles:', error);
    res.status(500).json({ error: 'Failed to get rejected profiles' });
  }
});

// Capture ML features for swipe rejection (for analytics)
router.post('/ml-features', async (req, res) => {
  try {
    const { profileId, features } = req.body;
    const userId = req.userId;

    // Validate features
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'ML features must be an object' });
    }

    const result = await rejectService.captureSwipeFeatures(userId, profileId, features);

    logger.info(`Captured ML features for user ${userId}`);
    res.json(result);

  } catch (error) {
    logger.error('Error capturing ML features:', error);
    res.status(500).json({ error: 'Failed to capture ML features' });
  }
});

// Validate reject (for frontend pre-check)
router.post('/validate', validateRejectRequest, async (req, res) => {
  try {
    const { profileId } = req.body;
    const userId = req.userId;

    const validation = await rejectService.validateReject(userId, profileId);
    
    res.json(validation);

  } catch (error) {
    logger.error('Error validating reject:', error);
    res.status(500).json({ error: 'Failed to validate reject' });
  }
});

// Get rejection analytics (for user insights)
router.get('/analytics', async (req, res) => {
  try {
    const userId = req.userId;
    
    // In production, this would aggregate rejection data
    // For now, return basic stats
    const { Reject } = require('../models/Reject');
    
    const totalRejects = await Reject.countDocuments({ fromUser: userId });
    const recentRejects = await Reject.countDocuments({
      fromUser: userId,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    });

    res.json({
      totalRejects,
      recentRejects,
      averagePerDay: Math.round(recentRejects / 30 * 10) / 10
    });

  } catch (error) {
    logger.error('Error getting rejection analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

module.exports = router;
