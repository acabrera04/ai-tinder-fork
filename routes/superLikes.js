const express = require('express');
const { SuperLikeService, validateSuperLikeRequest } = require('../services/SuperLikeService');
const { authenticateToken, userRateLimit } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize service
const superLikeService = new SuperLikeService();

// All routes require authentication
router.use(authenticateToken);

// Super like a profile
router.post('/', validateSuperLikeRequest, userRateLimit(60 * 1000, 2), async (req, res) => {
  try {
    const { profileId } = req.body;
    const userId = req.userId;

    const result = await superLikeService.superLikeProfile(userId, profileId);

    logger.info(`User ${userId} super liked profile ${profileId}`);
    res.json(result);

  } catch (error) {
    logger.error('Error super liking profile:', error);
    
    if (error.message.includes('Rate limit')) {
      return res.status(429).json({ error: error.message });
    }
    
    if (error.message.includes('quota exceeded')) {
      return res.status(429).json({ error: error.message });
    }
    
    if (error.message.includes('already liked')) {
      return res.status(409).json({ error: error.message });
    }
    
    if (error.message.includes('not found') || error.message.includes('active')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to super like profile' });
  }
});

// Get super like quota information
router.get('/quota', async (req, res) => {
  try {
    const userId = req.userId;

    const quotaInfo = await superLikeService.checkQuota(userId);
    
    res.json(quotaInfo);

  } catch (error) {
    logger.error('Error getting quota info:', error);
    res.status(500).json({ error: 'Failed to get quota information' });
  }
});

// Get user's super liked profiles
router.get('/my-super-likes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const userId = req.userId;

    const profiles = await superLikeService.getSuperLikedProfiles(userId, page, limit);
    
    res.json({
      profiles,
      page,
      limit,
      hasMore: profiles.length === limit
    });

  } catch (error) {
    logger.error('Error getting super liked profiles:', error);
    res.status(500).json({ error: 'Failed to get super liked profiles' });
  }
});

// Get profiles that super liked the user
router.get('/received', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const userId = req.userId;

    // Find super likes where toUser is current user
    const { Like } = require('../models/Like');
    
    const receivedSuperLikes = await Like.find({ 
      toUser: userId,
      type: 'super_like'
    })
      .populate('fromUser', 'profile')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const profiles = receivedSuperLikes.map(like => ({
      profileId: like.fromUser._id,
      profile: like.fromUser.profile,
      superLikedAt: like.createdAt,
      isMatch: like.isMatch
    }));

    res.json({
      profiles,
      page,
      limit,
      hasMore: profiles.length === limit
    });

  } catch (error) {
    logger.error('Error getting received super likes:', error);
    res.status(500).json({ error: 'Failed to get received super likes' });
  }
});

// Check if super like quota is available
router.get('/quota/available', async (req, res) => {
  try {
    const userId = req.userId;

    const isAvailable = await superLikeService.checkQuota(userId).then(q => q.isAvailable);
    
    res.json({ isAvailable });

  } catch (error) {
    logger.error('Error checking quota availability:', error);
    res.status(500).json({ error: 'Failed to check quota availability' });
  }
});

// Admin endpoint to reset user quota (for testing/support)
router.post('/quota/reset', authenticateToken, async (req, res) => {
  // In production, this should check for admin role
  // For now, allow any authenticated user to reset their own quota
  try {
    const userId = req.userId;

    // This would typically be an admin-only operation
    // For demo purposes, allowing users to reset their own quota
    
    const { QuotaManager } = require('../services/QuotaManager');
    const quotaManager = new QuotaManager();
    
    await quotaManager.resetQuota(userId);
    
    logger.info(`User ${userId} reset super like quota`);
    res.json({ message: 'Quota reset successfully' });

  } catch (error) {
    logger.error('Error resetting quota:', error);
    res.status(500).json({ error: 'Failed to reset quota' });
  }
});

module.exports = router;
