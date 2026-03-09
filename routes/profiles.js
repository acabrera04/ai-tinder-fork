const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const Like = require('../models/Like');
const Reject = require('../models/Reject');
const { getRedisClient } = require('../config/redis');
const { authenticateToken, userRateLimit } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get current user's profile
router.get('/me', async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ profile: user.profile, preferences: user.preferences });
  } catch (error) {
    logger.error('Error getting user profile:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update user profile
router.put('/me', [
  // Validation rules
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  
  body('age')
    .optional()
    .isInt({ min: 18, max: 100 })
    .withMessage('Age must be between 18 and 100'),
  
  body('bio')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),
  
  body('job')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Job cannot exceed 100 characters'),
  
  body('location')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Location must be between 2 and 100 characters'),
  
  body('tags')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Cannot have more than 10 tags'),
  
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  
  body('images.*.url')
    .optional()
    .isURL()
    .withMessage('Image URL must be valid'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const updates = req.body;
    const user = await User.findById(req.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update profile fields
    Object.keys(updates).forEach(key => {
      if (user.profile.hasOwnProperty(key)) {
        user.profile[key] = updates[key];
      } else if (user.preferences.hasOwnProperty(key)) {
        user.preferences[key] = updates[key];
      }
    });

    await user.save();

    logger.info(`User ${req.userId} updated profile`);
    res.json({ 
      message: 'Profile updated successfully',
      profile: user.profile,
      preferences: user.preferences
    });

  } catch (error) {
    logger.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get potential profiles for swiping
router.get('/potential', [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be non-negative'),
], userRateLimit(60 * 1000, 30), // 30 requests per minute
async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const currentUser = await User.findById(req.userId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build match criteria based on preferences
    const matchCriteria = {
      _id: { $ne: req.userId }, // Exclude self
      isActive: true,
      'profile.age': {
        $gte: currentUser.preferences.ageRange.min,
        $lte: currentUser.preferences.ageRange.max
      }
    };

    // Add gender preferences
    if (currentUser.preferences.interestedIn.length > 0) {
      matchCriteria['profile.gender'] = { $in: currentUser.preferences.interestedIn };
    }

    // Exclude already liked/rejected users
    const [likedUsers, rejectedUsers] = await Promise.all([
      Like.find({ fromUser: req.userId }).distinct('toUser'),
      Reject.find({ fromUser: req.userId }).distinct('toUser')
    ]);
    
    const excludedUsers = [...likedUsers, ...rejectedUsers];
    if (excludedUsers.length > 0) {
      matchCriteria._id.$nin = excludedUsers;
    }

    // Get profiles from user's pool (for scalability)
    const redis = getRedisClient();
    const poolKey = `user_pool:${req.userId}`;
    let poolUsers = await redis.sMembers(poolKey);
    
    if (poolUsers.length === 0) {
      // If no pool, create one with basic filtering
      const potentialUsers = await User.find(matchCriteria)
        .select('profile _id')
        .limit(1000) // Limit for performance
        .lean();
      
      poolUsers = potentialUsers.map(u => u._id.toString());
      await redis.sAdd(poolKey, poolUsers);
      await redis.expire(poolKey, 3600); // 1 hour expiration
    }

    // Get profiles from pool
    const profileIds = poolUsers.slice(offset, offset + limit);
    
    if (profileIds.length === 0) {
      return res.json({ profiles: [] });
    }

    const profiles = await User.find({
      _id: { $in: profileIds },
      ...matchCriteria
    })
    .select('profile _id')
    .lean();

    // Shuffle for randomness
    const shuffledProfiles = profiles.sort(() => Math.random() - 0.5);

    res.json({ profiles: shuffledProfiles });

  } catch (error) {
    logger.error('Error getting potential profiles:', error);
    res.status(500).json({ error: 'Failed to get profiles' });
  }
});

// Get specific profile by ID
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot view own profile' });
    }

    const profile = await User.findById(userId).select('profile _id');
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if user has liked or rejected this profile
    const [hasLiked, hasRejected] = await Promise.all([
      Like.findOne({ fromUser: req.userId, toUser: userId }),
      Reject.findOne({ fromUser: req.userId, toUser: userId })
    ]);

    const profileData = {
      ...profile.toObject(),
      hasLiked: !!hasLiked,
      hasRejected: !!hasRejected
    };

    res.json({ profile: profileData });

  } catch (error) {
    logger.error('Error getting profile:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Get user's liked profiles
router.get('/me/liked', [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be at least 1'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
], async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    const likes = await Like.find({ fromUser: req.userId })
      .populate('toUser', 'profile')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    
    const profiles = likes.map(like => ({
      profileId: like.toUser._id,
      profile: like.toUser.profile,
      likedAt: like.createdAt,
      isMatch: like.isMatch
    }));
    
    res.json({ profiles, page, limit });

  } catch (error) {
    logger.error('Error getting liked profiles:', error);
    res.status(500).json({ error: 'Failed to get liked profiles' });
  }
});

// Update user preferences
router.put('/me/preferences', [
  body('ageRange.min')
    .optional()
    .isInt({ min: 18, max: 100 })
    .withMessage('Min age must be between 18 and 100'),
  
  body('ageRange.max')
    .optional()
    .isInt({ min: 18, max: 100 })
    .withMessage('Max age must be between 18 and 100'),
  
  body('maxDistance')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('Max distance must be between 1 and 500 km'),
  
  body('interestedIn')
    .optional()
    .isArray({ min: 1 })
    .withMessage('Interested in must be an array'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const updates = req.body;
    const user = await User.findById(req.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update preferences
    Object.keys(updates).forEach(key => {
      if (user.preferences.hasOwnProperty(key)) {
        user.preferences[key] = updates[key];
      }
    });

    await user.save();

    // Clear user's profile pool to refresh matches
    const redis = getRedisClient();
    await redis.del(`user_pool:${req.userId}`);

    logger.info(`User ${req.userId} updated preferences`);
    res.json({ 
      message: 'Preferences updated successfully',
      preferences: user.preferences
    });

  } catch (error) {
    logger.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

module.exports = router;
