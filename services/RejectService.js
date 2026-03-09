const { body, validationResult } = require('express-validator');
const Reject = require('../models/Reject');
const User = require('../models/User');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

class RejectService {
  async rejectProfile(userId, profileId, mlFeatures = null) {
    try {
      // Validation
      if (!userId || !profileId) {
        throw new Error('User ID and Profile ID are required');
      }
      
      if (userId === profileId) {
        throw new Error('Users cannot reject themselves');
      }
      
      // Check rate limiting
      await this.checkRateLimit(userId);
      
      // Validate users exist
      const [fromUser, toUser] = await Promise.all([
        User.findById(userId),
        User.findById(profileId)
      ]);
      
      if (!fromUser || !toUser) {
        throw new Error('User not found');
      }
      
      if (!fromUser.isActive || !toUser.isActive) {
        throw new Error('User account is not active');
      }
      
      // Check if already rejected
      const existingReject = await Reject.findOne({
        fromUser: userId,
        toUser: profileId
      });
      
      if (existingReject) {
        throw new Error('Already rejected this profile');
      }
      
      // Create reject
      const reject = new Reject({
        fromUser: userId,
        toUser: profileId,
        mlFeatures
      });
      
      await reject.save();
      
      // Update user stats
      await User.updateOne(
        { _id: userId },
        { 
          $inc: { 'stats.rejects': 1 },
          $set: { lastActive: new Date() }
        }
      );
      
      // Cache reject status
      const redis = getRedisClient();
      await redis.setEx(`reject:${userId}:${profileId}`, 86400, 'true'); // 24 hours
      
      // Remove from user's profile pool
      const poolKey = `user_pool:${userId}`;
      await redis.sRem(poolKey, profileId);
      
      // Log activity
      logger.info(`User ${userId} rejected profile ${profileId}`);
      
      return {
        success: true,
        rejectId: reject._id,
        message: 'Profile rejected'
      };
      
    } catch (error) {
      logger.error('Error in rejectProfile:', error);
      throw error;
    }
  }
  
  async validateReject(userId, profileId) {
    try {
      // Check if users exist and are active
      const [fromUser, toUser] = await Promise.all([
        User.findById(userId).select('isActive'),
        User.findById(profileId).select('isActive')
      ]);
      
      if (!fromUser || !toUser) {
        return { valid: false, reason: 'User not found' };
      }
      
      if (!fromUser.isActive || !toUser.isActive) {
        return { valid: false, reason: 'User account is not active' };
      }
      
      // Check if already rejected
      const existingReject = await Reject.findOne({
        fromUser: userId,
        toUser: profileId
      });
      
      if (existingReject) {
        return { valid: false, reason: 'Already rejected' };
      }
      
      return { valid: true };
      
    } catch (error) {
      logger.error('Error in validateReject:', error);
      return { valid: false, reason: 'Validation error' };
    }
  }
  
  async checkRateLimit(userId) {
    try {
      const redis = getRedisClient();
      const key = `rate_limit:reject:${userId}`;
      const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000; // 15 minutes
      const maxRequests = 100; // Allow more rejects than likes
      
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }
      
      if (current > maxRequests) {
        throw new Error('Rate limit exceeded for rejects');
      }
      
      return true;
      
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      throw error;
    }
  }
  
  async getRejectedProfiles(userId, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;
      
      const rejects = await Reject.find({ fromUser: userId })
        .populate('toUser', 'profile')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      
      const profiles = rejects.map(reject => ({
        profileId: reject.toUser._id,
        profile: reject.toUser.profile,
        rejectedAt: reject.createdAt
      }));
      
      return profiles;
      
    } catch (error) {
      logger.error('Error getting rejected profiles:', error);
      throw error;
    }
  }
  
  async checkIfRejected(userId, profileId) {
    try {
      // Check cache first
      const redis = getRedisClient();
      const cached = await redis.get(`reject:${userId}:${profileId}`);
      
      if (cached) {
        return cached === 'true';
      }
      
      // Check database
      const reject = await Reject.findOne({
        fromUser: userId,
        toUser: profileId
      });
      
      const isRejected = !!reject;
      
      // Cache result
      await redis.setEx(`reject:${userId}:${profileId}`, 3600, isRejected.toString());
      
      return isRejected;
      
    } catch (error) {
      logger.error('Error checking if rejected:', error);
      return false;
    }
  }
  
  // Method to capture ML features for swipe rejection
  async captureSwipeFeatures(userId, profileId, features) {
    try {
      // Validate features
      const requiredFeatures = ['swipeVelocity', 'timeOnProfile'];
      const missingFeatures = requiredFeatures.filter(f => !features.hasOwnProperty(f));
      
      if (missingFeatures.length > 0) {
        throw new Error(`Missing required ML features: ${missingFeatures.join(', ')}`);
      }
      
      // In production, this would queue for async processing
      logger.info(`ML features captured for user ${userId}:`, features);
      
      // For now, we'll store with the reject if it exists
      // In a real implementation, this might be a separate analytics collection
      
      return { success: true };
      
    } catch (error) {
      logger.error('Error capturing swipe features:', error);
      throw error;
    }
  }
}

// Validation middleware
const validateRejectRequest = [
  body('profileId')
    .isMongoId()
    .withMessage('Invalid profile ID'),
  
  body('mlFeatures')
    .optional()
    .isObject()
    .withMessage('ML features must be an object'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }
    next();
  }
];

module.exports = { RejectService, validateRejectRequest };
