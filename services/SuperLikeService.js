const { body, validationResult } = require('express-validator');
const Like = require('../models/Like');
const User = require('../models/User');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const QuotaManager = require('./QuotaManager');
const NotificationService = require('./NotificationService');

class SuperLikeService {
  constructor() {
    this.quotaManager = new QuotaManager();
    this.notificationService = new NotificationService();
  }

  async superLikeProfile(userId, profileId) {
    try {
      // Validation
      if (!userId || !profileId) {
        throw new Error('User ID and Profile ID are required');
      }
      
      if (userId === profileId) {
        throw new Error('Users cannot super like themselves');
      }
      
      // Check rate limiting
      await this.checkRateLimit(userId);
      
      // Check quota availability
      const quotaAvailable = await this.quotaManager.isQuotaAvailable(userId);
      if (!quotaAvailable) {
        throw new Error('Super like quota exceeded');
      }
      
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
      
      // Check if already liked (including super liked)
      const existingLike = await Like.findOne({
        fromUser: userId,
        toUser: profileId
      });
      
      if (existingLike) {
        throw new Error('Already liked this profile');
      }
      
      // Consume quota
      await this.quotaManager.consumeQuota(userId);
      
      // Create super like
      const superLike = new Like({
        fromUser: userId,
        toUser: profileId,
        type: 'super_like'
      });
      
      await superLike.save();
      
      // Update user stats
      await User.updateOne(
        { _id: userId },
        { 
          $inc: { 'stats.superLikesGiven': 1 },
          $set: { lastActive: new Date() }
        }
      );
      
      await User.updateOne(
        { _id: profileId },
        { $inc: { 'stats.superLikesReceived': 1 } }
      );
      
      // Cache like status
      const redis = getRedisClient();
      await redis.setEx(`like:${userId}:${profileId}`, 86400, 'super_like');
      
      // Send notification to target user
      await this.notificationService.sendSuperLikeNotification(
        profileId, 
        fromUser
      );
      
      // Queue for priority matching
      await this.prioritizeMatch(userId, profileId);
      
      // Log activity
      logger.info(`User ${userId} super liked profile ${profileId}`);
      
      return {
        success: true,
        likeId: superLike._id,
        isMatch: superLike.isMatch,
        message: superLike.isMatch ? 'Super match!' : 'Super like sent!'
      };
      
    } catch (error) {
      logger.error('Error in superLikeProfile:', error);
      throw error;
    }
  }
  
  async checkQuota(userId) {
    try {
      const quotaInfo = await this.quotaManager.getQuotaInfo(userId);
      return quotaInfo;
    } catch (error) {
      logger.error('Error checking quota:', error);
      throw error;
    }
  }
  
  async consumeQuota(userId) {
    try {
      const success = await this.quotaManager.consumeQuota(userId);
      return success;
    } catch (error) {
      logger.error('Error consuming quota:', error);
      throw error;
    }
  }
  
  async checkRateLimit(userId) {
    try {
      const redis = getRedisClient();
      const key = `rate_limit:superlike:${userId}`;
      const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000; // 15 minutes
      const maxRequests = 5; // Very limited for super likes
      
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }
      
      if (current > maxRequests) {
        throw new Error('Rate limit exceeded for super likes');
      }
      
      return true;
      
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      throw error;
    }
  }
  
  async prioritizeMatch(userId, profileId) {
    try {
      const redis = getRedisClient();
      const priorityKey = `priority_matches:${profileId}`;
      
      // Add to priority queue with timestamp
      await redis.zAdd(priorityKey, {
        score: Date.now(),
        value: userId
      });
      
      // Set expiration (24 hours)
      await redis.expire(priorityKey, 86400);
      
      logger.info(`Added user ${userId} to priority queue for profile ${profileId}`);
      
    } catch (error) {
      logger.error('Error prioritizing match:', error);
    }
  }
  
  async getSuperLikedProfiles(userId, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;
      
      const superLikes = await Like.find({ 
        fromUser: userId,
        type: 'super_like'
      })
        .populate('toUser', 'profile')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      
      const profiles = superLikes.map(like => ({
        profileId: like.toUser._id,
        profile: like.toUser.profile,
        superLikedAt: like.createdAt,
        isMatch: like.isMatch
      }));
      
      return profiles;
      
    } catch (error) {
      logger.error('Error getting super liked profiles:', error);
      throw error;
    }
  }
  
  // Method to reset daily quotas (called by scheduled job)
  async resetDailyQuotas() {
    try {
      const resetHour = parseInt(process.env.SUPER_LIKE_RESET_HOUR) || 0;
      const now = new Date();
      
      if (now.getUTCHours() === resetHour) {
        const redis = getRedisClient();
        const pattern = `superlike_quota:*`;
        
        // In Redis, we can't directly reset all keys, but in production
        // this would be handled by a cron job or Redis scripts
        logger.info('Daily super like quota reset triggered');
        
        // For now, just log - in real implementation, use Redis SCAN
        // and reset keys that match the pattern
      }
    } catch (error) {
      logger.error('Error resetting daily quotas:', error);
    }
  }
}

// Validation middleware
const validateSuperLikeRequest = [
  body('profileId')
    .isMongoId()
    .withMessage('Invalid profile ID'),
  
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

module.exports = { SuperLikeService, validateSuperLikeRequest };
