const express = require('express');
const { LikeService, validateLikeRequest } = require('../services/LikeService');
const { authenticateToken, userRateLimit } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize service
const likeService = new LikeService();

// All routes require authentication
router.use(authenticateToken);

// Like a profile
router.post('/', validateLikeRequest, userRateLimit(60 * 1000, 10), async (req, res) => {
  try {
    const { profileId } = req.body;
    const userId = req.userId;

    const result = await likeService.likeProfile(userId, profileId);

    logger.info(`User ${userId} liked profile ${profileId}`);
    res.json(result);

  } catch (error) {
    logger.error('Error liking profile:', error);
    
    if (error.message.includes('Rate limit')) {
      return res.status(429).json({ error: error.message });
    }
    
    if (error.message.includes('already liked')) {
      return res.status(409).json({ error: error.message });
    }
    
    if (error.message.includes('not found') || error.message.includes('active')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to like profile' });
  }
});

// Check if user has liked a profile
router.get('/check/:profileId', async (req, res) => {
  try {
    const { profileId } = req.params;
    const userId = req.userId;

    const hasLiked = await likeService.checkIfLiked(userId, profileId);
    
    res.json({ hasLiked });

  } catch (error) {
    logger.error('Error checking like status:', error);
    res.status(500).json({ error: 'Failed to check like status' });
  }
});

// Get user's liked profiles
router.get('/my-likes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const userId = req.userId;

    const profiles = await likeService.getLikedProfiles(userId, page, limit);
    
    res.json({
      profiles,
      page,
      limit,
      hasMore: profiles.length === limit
    });

  } catch (error) {
    logger.error('Error getting liked profiles:', error);
    res.status(500).json({ error: 'Failed to get liked profiles' });
  }
});

// Get profiles that liked the user
router.get('/received', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const userId = req.userId;

    // Find likes where toUser is current user
    const { Like } = require('../models/Like');
    
    const receivedLikes = await Like.find({ toUser: userId })
      .populate('fromUser', 'profile')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const profiles = receivedLikes.map(like => ({
      profileId: like.fromUser._id,
      profile: like.fromUser.profile,
      likedAt: like.createdAt,
      isMatch: like.isMatch
    }));

    res.json({
      profiles,
      page,
      limit,
      hasMore: profiles.length === limit
    });

  } catch (error) {
    logger.error('Error getting received likes:', error);
    res.status(500).json({ error: 'Failed to get received likes' });
  }
});

// Get mutual likes (matches)
router.get('/matches', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const userId = req.userId;

    // Find matches where user is part of the match
    const { Match } = require('../models/Match');
    
    const matches = await Match.find({
      users: userId,
      isActive: true
    })
    .populate('users', 'profile')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

    const matchProfiles = matches.map(match => {
      const otherUser = match.users.find(u => !u._id.equals(userId));
      return {
        matchId: match._id,
        profileId: otherUser._id,
        profile: otherUser.profile,
        matchedAt: match.createdAt,
        lastMessageAt: match.lastMessageAt,
        unreadCount: match.unreadCount
      };
    });

    res.json({
      matches: matchProfiles,
      page,
      limit,
      hasMore: matchProfiles.length === limit
    });

  } catch (error) {
    logger.error('Error getting matches:', error);
    res.status(500).json({ error: 'Failed to get matches' });
  }
});

// Validate like (for frontend pre-check)
router.post('/validate', validateLikeRequest, async (req, res) => {
  try {
    const { profileId } = req.body;
    const userId = req.userId;

    const validation = await likeService.validateLike(userId, profileId);
    
    res.json(validation);

  } catch (error) {
    logger.error('Error validating like:', error);
    res.status(500).json({ error: 'Failed to validate like' });
  }
});

module.exports = router;
