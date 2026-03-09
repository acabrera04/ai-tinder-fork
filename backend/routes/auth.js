const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validate: isUuid } = require('uuid');
const userRepository = require('../repositories/userRepository');

const router = express.Router();
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid email required' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' });
    }

    const existing = await userRepository.findByEmail(email.toLowerCase().trim());
    if (existing) {
      return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await userRepository.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      displayName: displayName || null,
    });

    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    return res.status(201).json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and password required' });
    }

    const user = await userRepository.findByEmail(email.toLowerCase().trim());
    if (!user) {
      // Timing-safe: hash a dummy value to prevent user enumeration via timing
      await bcrypt.hash('dummy', BCRYPT_ROUNDS);
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    return res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Login failed' });
  }
});

module.exports = router;
