const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// User registration
router.post('/register', [
  // Validation rules
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  
  body('age')
    .isInt({ min: 18, max: 100 })
    .withMessage('Age must be between 18 and 100'),
  
  body('location')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Location is required'),
  
  body('gender')
    .optional()
    .isIn(['male', 'female', 'non-binary', 'other'])
    .withMessage('Invalid gender'),
  
  body('interestedIn')
    .optional()
    .isArray({ min: 1 })
    .withMessage('Interested in must be an array'),
  
  body('bio')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),
  
  body('job')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Job cannot exceed 100 characters'),
  
  body('tags')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Cannot have more than 10 tags'),
  
  // Custom validation for duplicate email
  body('email').custom(async (value) => {
    const existingUser = await User.findOne({ email: value });
    if (existingUser) {
      throw new Error('Email already registered');
    }
    return true;
  })
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

    const {
      email,
      password,
      name,
      age,
      location,
      gender,
      interestedIn,
      bio,
      job,
      tags
    } = req.body;

    // Create user
    const user = new User({
      email,
      password,
      profile: {
        name,
        age,
        location,
        bio,
        job,
        tags: tags || []
      },
      preferences: {
        interestedIn: interestedIn || []
      }
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Log registration
    logger.info(`User registered: ${user._id} - ${email}`);

    // Return user data (without password) and token
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      message: 'User registered successfully',
      user: userResponse,
      token
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User login
router.post('/login', [
  // Validation rules
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
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

    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    // Update last active
    user.lastActive = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Log login
    logger.info(`User logged in: ${user._id} - ${email}`);

    // Return user data and token
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({
      message: 'Login successful',
      user: userResponse,
      token
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout (blacklist token)
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(400).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    
    // Blacklist the token
    const redis = getRedisClient();
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redis.setEx(`blacklist:${token}`, ttl, 'true');
      }
    }

    res.json({ message: 'Logged out successfully' });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Refresh token (optional endpoint)
router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(400).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify current token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Generate new token
    const newToken = generateToken(decoded.userId);
    
    res.json({
      message: 'Token refreshed',
      token: newToken
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
