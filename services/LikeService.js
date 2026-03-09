const { body, validationResult } = require('express-validator');
const Like = require('../models/Like');
const User = require('../models/User');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class LikeService {
  async likeProfile(userId, profileId) {
    try {
      // Validation
      if (!userId || !profileId) {
        throw new Error('User ID and Profile ID are required');
      }
      
      if (userId === profileId) {
        throw new Error('Users cannot like themselves');
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
      
      // Check if already liked
      const existingLike = await Like.findOne({
        fromUser: userId,
        toUser: profileId
      });
      
      if (existingLike) {
        throw new Error('Already liked this profile');
      }
      
      // Create like
      const like = new Like({
        fromUser: userId,
        toUser: profileId,
        type: 'like'
      });
      
      await like.save();
      
      // Update user stats
      await User.updateOne(
        { _id: userId },
        { 
          $inc: { 'stats.likesGiven': 1 },
          $set: { lastActive: new Date() }
        }
      );
      
      await User.updateOne(
        { _id: profileId },
        { $inc: { 'stats.likesReceived': 1 } }
      );
      
      // Cache like status
      const redis = getRedisClient();
      await redis.setEx(`like:${userId}:${profileId}`, 86400, 'true'); // 24 hours
      
      // Log activity
      logger.info(`User ${userId} liked profile ${profileId}`);
      
      return {
        success: true,
        likeId: like._id,
        isMatch: like.isMatch,
        message: like.isMatch ? 'It\'s a match!' : 'Profile liked'
      };
      
    } catch (error) {
      logger.error('Error in likeProfile:', error);
      throw error;
    }
  }
  
  async validateLike(userId, profileId) {
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
      
      // Check if already liked
      const existingLike = await Like.findOne({
        fromUser: userId,
        toUser: profileId
      });
      
      if (existingLike) {
        return { valid: false, reason: 'Already liked' };
      }
      
      return { valid: true };
      
    } catch (error) {
      logger.error('Error in validateLike:', error);
      return { valid: false, reason: 'Validation error' };
    }
  }
  
  async checkRateLimit(userId) {
    try {
      const redis = getRedisClient();
      const key = `rate_limit:like:${userId}`;
      const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000; // 15 minutes
      const maxRequests = 50; // Specific limit for likes
      
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }
      
      if (current > maxRequests) {
        throw new Error('Rate limit exceeded for likes');
      }
      
      return true;
      
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      throw error;
    }
  }
  
  async getLikedProfiles(userId, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;
      
      const likes = await Like.find({ fromUser: userId })
        .populate('toUser', 'profile')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      
      const profiles = likes.map(like => ({
        profileId: like.toUser._id,
        profile: like.toUser.profile,
        likedAt: like.createdAt,
        isMatch: like.isMatch
      }));
      
      return profiles;
      
    } catch (error) {
      logger.error('Error getting liked profiles:', error);
      throw error;
    }
  }
  
  async checkIfLiked(userId, profileId) {
    try {
      // Check cache first
      const redis = getRedisClient();
      const cached = await redis.get(`like:${userId}:${profileId}`);
      
      if (cached) {
        return cached === 'true';
      }
      
      // Check database
      const like = await Like.findOne({
        fromUser: userId,
        toUser: profileId
      });
      
      const isLiked = !!like;
      
      // Cache result
      await redis.setEx(`like:${userId}:${profileId}`, 3600, isLiked.toString());
      
      return isLiked;
      
    } catch (error) {
      logger.error('Error checking if liked:', error);
      return false;
    }
  }
}

// Validation middleware
const validateLikeRequest = [
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

module.exports = { LikeService, validateLikeRequest };
