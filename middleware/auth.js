const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Check if token is blacklisted
    const redis = getRedisClient();
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }
    
    // Add user to request object
    req.user = user;
    req.userId = user._id;
    
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Optional authentication - doesn't fail if no token
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return next();
    }

    const redis = getRedisClient();
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (user && user.isActive) {
      req.user = user;
      req.userId = user._id;
    }
    
    next();
  } catch (error) {
    // Silently fail for optional auth
    next();
  }
};

// Check if user owns the resource
const requireOwnership = (resourceUserId) => {
  return (req, res, next) => {
    if (req.userId.toString() !== resourceUserId.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};

// Rate limiting per user
const userRateLimit = (windowMs, maxRequests) => {
  return async (req, res, next) => {
    try {
      if (!req.userId) {
        return next();
      }
      
      const redis = getRedisClient();
      const key = `rate_limit:user:${req.userId}:${req.route.path}`;
      
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }
      
      if (current > maxRequests) {
        return res.status(429).json({ 
          error: 'Rate limit exceeded',
          retryAfter: windowMs / 1000
        });
      }
      
      next();
    } catch (error) {
      logger.error('Rate limiting error:', error);
      next();
    }
  };
};

module.exports = {
  authenticateToken,
  optionalAuthenticate,
  requireOwnership,
  userRateLimit
};
