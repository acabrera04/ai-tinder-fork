'use strict';

jest.mock('../models/Like');
jest.mock('../models/User');
jest.mock('../config/redis');
jest.mock('../utils/logger');
jest.mock('express-validator', () => {
  // Build a chainable validator stub so the module-level array definition works
  const chain = {};
  chain.isMongoId = jest.fn().mockReturnValue(chain);
  chain.withMessage = jest.fn().mockReturnValue(jest.fn()); // final call returns middleware fn
  return {
    body: jest.fn().mockReturnValue(chain),
    validationResult: jest.fn(),
  };
});

const { LikeService, validateLikeRequest } = require('./LikeService');
const Like = require('../models/Like');
const User = require('../models/User');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const { validationResult } = require('express-validator');

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeId = (n = 0) => `507f1f77bcf86cd79943901${n}`;

const makeUser = (overrides = {}) => ({
  _id: makeId(1),
  isActive: true,
  ...overrides,
});

const makeRedis = (overrides = {}) => ({
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  setEx: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  ...overrides,
});

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  logger.info = jest.fn();
  logger.error = jest.fn();
  logger.warn = jest.fn();
});

// ════════════════════════════════════════════════════════════════════════════
// likeProfile
// ════════════════════════════════════════════════════════════════════════════

describe('LikeService.likeProfile', () => {
  let service;

  beforeEach(() => {
    service = new LikeService();
  });

  // ── Input validation ─────────────────────────────────────────────────────

  test('throws when userId is missing', async () => {
    await expect(service.likeProfile(null, makeId(2))).rejects.toThrow(
      'User ID and Profile ID are required'
    );
  });

  test('throws when profileId is missing', async () => {
    await expect(service.likeProfile(makeId(1), null)).rejects.toThrow(
      'User ID and Profile ID are required'
    );
  });

  test('throws when both ids are missing', async () => {
    await expect(service.likeProfile(undefined, undefined)).rejects.toThrow(
      'User ID and Profile ID are required'
    );
  });

  test('throws when userId equals profileId', async () => {
    const id = makeId(1);
    await expect(service.likeProfile(id, id)).rejects.toThrow(
      'Users cannot like themselves'
    );
  });

  // ── Rate limiting ────────────────────────────────────────────────────────

  test('throws when rate limit is exceeded', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(51) });
    getRedisClient.mockReturnValue(redis);

    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow(
      'Rate limit exceeded for likes'
    );
  });

  // ── User existence ───────────────────────────────────────────────────────

  test('throws when fromUser does not exist', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));

    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow(
      'User not found'
    );
  });

  test('throws when toUser does not exist', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(null);

    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow(
      'User not found'
    );
  });

  // ── Active status ────────────────────────────────────────────────────────

  test('throws when fromUser account is not active', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser({ isActive: false }))
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));

    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow(
      'User account is not active'
    );
  });

  test('throws when toUser account is not active', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2), isActive: false }));

    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow(
      'User account is not active'
    );
  });

  // ── Duplicate like ───────────────────────────────────────────────────────

  test('throws when like already exists', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));
    Like.findOne.mockResolvedValue({ _id: makeId(9) }); // existing like

    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow(
      'Already liked this profile'
    );
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  test('returns success result with no match', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));
    Like.findOne.mockResolvedValue(null);

    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    const result = await service.likeProfile(makeId(1), makeId(2));

    expect(result.success).toBe(true);
    expect(result.isMatch).toBe(false);
    expect(result.message).toBe('Profile liked');
    expect(result.likeId).toBe(savedLike._id);
  });

  test('returns match message when isMatch is true', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));
    Like.findOne.mockResolvedValue(null);

    const savedLike = { _id: makeId(9), isMatch: true, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    const result = await service.likeProfile(makeId(1), makeId(2));

    expect(result.message).toBe("It's a match!");
  });

  test('updates likesGiven stat for fromUser', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    const userId = makeId(1);
    const profileId = makeId(2);
    User.findById
      .mockResolvedValueOnce(makeUser({ _id: userId }))
      .mockResolvedValueOnce(makeUser({ _id: profileId }));
    Like.findOne.mockResolvedValue(null);
    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    await service.likeProfile(userId, profileId);

    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      expect.objectContaining({ $inc: { 'stats.likesGiven': 1 } })
    );
  });

  test('updates likesReceived stat for toUser', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    const userId = makeId(1);
    const profileId = makeId(2);
    User.findById
      .mockResolvedValueOnce(makeUser({ _id: userId }))
      .mockResolvedValueOnce(makeUser({ _id: profileId }));
    Like.findOne.mockResolvedValue(null);
    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    await service.likeProfile(userId, profileId);

    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: profileId },
      { $inc: { 'stats.likesReceived': 1 } }
    );
  });

  test('caches like status in redis', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    const userId = makeId(1);
    const profileId = makeId(2);
    User.findById
      .mockResolvedValueOnce(makeUser({ _id: userId }))
      .mockResolvedValueOnce(makeUser({ _id: profileId }));
    Like.findOne.mockResolvedValue(null);
    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    await service.likeProfile(userId, profileId);

    expect(redis.setEx).toHaveBeenCalledWith(
      `like:${userId}:${profileId}`,
      86400,
      'true'
    );
  });

  test('creates like with correct type', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    const userId = makeId(1);
    const profileId = makeId(2);
    User.findById
      .mockResolvedValueOnce(makeUser({ _id: userId }))
      .mockResolvedValueOnce(makeUser({ _id: profileId }));
    Like.findOne.mockResolvedValue(null);
    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    const LikeMock = Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    await service.likeProfile(userId, profileId);

    expect(LikeMock).toHaveBeenCalledWith({
      fromUser: userId,
      toUser: profileId,
      type: 'like',
    });
  });

  // ── Rate limit window ────────────────────────────────────────────────────

  test('sets redis expiry on first request in window', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(1) });
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));
    Like.findOne.mockResolvedValue(null);
    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    await service.likeProfile(makeId(1), makeId(2));

    expect(redis.expire).toHaveBeenCalled();
  });

  test('does not set redis expiry after first request in window', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(5) });
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));
    Like.findOne.mockResolvedValue(null);
    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    await service.likeProfile(makeId(1), makeId(2));

    expect(redis.expire).not.toHaveBeenCalled();
  });

  test('allows exactly 50 likes before blocking', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(50) });
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));
    Like.findOne.mockResolvedValue(null);
    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockResolvedValue({});

    await expect(service.likeProfile(makeId(1), makeId(2))).resolves.toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateLike
// ════════════════════════════════════════════════════════════════════════════

describe('LikeService.validateLike', () => {
  let service;

  beforeEach(() => {
    service = new LikeService();
  });

  test('returns invalid when fromUser is not found', async () => {
    User.findById = jest.fn()
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser({ _id: makeId(2) })) });

    const result = await service.validateLike(makeId(1), makeId(2));

    expect(result).toEqual({ valid: false, reason: 'User not found' });
  });

  test('returns invalid when toUser is not found', async () => {
    User.findById = jest.fn()
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser()) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(null) });

    const result = await service.validateLike(makeId(1), makeId(2));

    expect(result).toEqual({ valid: false, reason: 'User not found' });
  });

  test('returns invalid when fromUser is inactive', async () => {
    User.findById = jest.fn()
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser({ isActive: false })) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser({ _id: makeId(2) })) });

    const result = await service.validateLike(makeId(1), makeId(2));

    expect(result).toEqual({ valid: false, reason: 'User account is not active' });
  });

  test('returns invalid when toUser is inactive', async () => {
    User.findById = jest.fn()
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser()) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser({ _id: makeId(2), isActive: false })) });

    const result = await service.validateLike(makeId(1), makeId(2));

    expect(result).toEqual({ valid: false, reason: 'User account is not active' });
  });

  test('returns invalid when like already exists', async () => {
    User.findById = jest.fn()
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser()) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser({ _id: makeId(2) })) });
    Like.findOne.mockResolvedValue({ _id: makeId(9) });

    const result = await service.validateLike(makeId(1), makeId(2));

    expect(result).toEqual({ valid: false, reason: 'Already liked' });
  });

  test('returns valid when all checks pass', async () => {
    User.findById = jest.fn()
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser()) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser({ _id: makeId(2) })) });
    Like.findOne.mockResolvedValue(null);

    const result = await service.validateLike(makeId(1), makeId(2));

    expect(result).toEqual({ valid: true });
  });

  test('returns validation error on thrown exception', async () => {
    User.findById = jest.fn().mockImplementation(() => {
      throw new Error('DB crash');
    });

    const result = await service.validateLike(makeId(1), makeId(2));

    expect(result).toEqual({ valid: false, reason: 'Validation error' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkRateLimit
// ════════════════════════════════════════════════════════════════════════════

describe('LikeService.checkRateLimit', () => {
  let service;

  beforeEach(() => {
    service = new LikeService();
  });

  test('returns true when under limit', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(10) });
    getRedisClient.mockReturnValue(redis);

    const result = await service.checkRateLimit(makeId(1));

    expect(result).toBe(true);
  });

  test('throws when over limit (51)', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(51) });
    getRedisClient.mockReturnValue(redis);

    await expect(service.checkRateLimit(makeId(1))).rejects.toThrow(
      'Rate limit exceeded for likes'
    );
  });

  test('does not throw at exactly 50', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(50) });
    getRedisClient.mockReturnValue(redis);

    await expect(service.checkRateLimit(makeId(1))).resolves.toBe(true);
  });

  test('sets expiry when count is 1', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(1) });
    getRedisClient.mockReturnValue(redis);

    await service.checkRateLimit(makeId(1));

    expect(redis.expire).toHaveBeenCalledWith(
      expect.stringContaining(makeId(1)),
      expect.any(Number)
    );
  });

  test('uses correct redis key format', async () => {
    const userId = makeId(1);
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(1) });
    getRedisClient.mockReturnValue(redis);

    await service.checkRateLimit(userId);

    expect(redis.incr).toHaveBeenCalledWith(`rate_limit:like:${userId}`);
  });

  test('rethrows redis errors', async () => {
    getRedisClient.mockReturnValue({
      incr: jest.fn().mockRejectedValue(new Error('Redis down')),
    });

    await expect(service.checkRateLimit(makeId(1))).rejects.toThrow('Redis down');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getLikedProfiles
// ════════════════════════════════════════════════════════════════════════════

describe('LikeService.getLikedProfiles', () => {
  let service;

  beforeEach(() => {
    service = new LikeService();
  });

  const makeLike = (toUserId, overrides = {}) => ({
    toUser: { _id: toUserId, profile: { name: 'Test User' } },
    createdAt: new Date('2024-01-01'),
    isMatch: false,
    ...overrides,
  });

  const makeChain = (results) => ({
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(results),
  });

  test('returns mapped profiles', async () => {
    const likes = [makeLike(makeId(2))];
    Like.find.mockReturnValue(makeChain(likes));

    const profiles = await service.getLikedProfiles(makeId(1));

    expect(profiles).toHaveLength(1);
    expect(profiles[0].profileId).toBe(makeId(2));
    expect(profiles[0].profile).toEqual({ name: 'Test User' });
    expect(profiles[0].isMatch).toBe(false);
  });

  test('uses default page 1 and limit 20', async () => {
    Like.find.mockReturnValue(makeChain([]));

    await service.getLikedProfiles(makeId(1));

    const chain = Like.find.mock.results[0].value;
    expect(chain.skip).toHaveBeenCalledWith(0);   // (1-1)*20
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  test('paginates correctly for page 2', async () => {
    Like.find.mockReturnValue(makeChain([]));

    await service.getLikedProfiles(makeId(1), 2, 10);

    const chain = Like.find.mock.results[0].value;
    expect(chain.skip).toHaveBeenCalledWith(10);  // (2-1)*10
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  test('queries by fromUser', async () => {
    const userId = makeId(1);
    Like.find.mockReturnValue(makeChain([]));

    await service.getLikedProfiles(userId);

    expect(Like.find).toHaveBeenCalledWith({ fromUser: userId });
  });

  test('returns empty array when no likes', async () => {
    Like.find.mockReturnValue(makeChain([]));

    const profiles = await service.getLikedProfiles(makeId(1));

    expect(profiles).toEqual([]);
  });

  test('includes likedAt timestamp', async () => {
    const date = new Date('2024-06-15');
    const likes = [makeLike(makeId(2), { createdAt: date })];
    Like.find.mockReturnValue(makeChain(likes));

    const profiles = await service.getLikedProfiles(makeId(1));

    expect(profiles[0].likedAt).toBe(date);
  });

  test('rethrows database errors', async () => {
    Like.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    await expect(service.getLikedProfiles(makeId(1))).rejects.toThrow('DB error');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkIfLiked
// ════════════════════════════════════════════════════════════════════════════

describe('LikeService.checkIfLiked', () => {
  let service;

  beforeEach(() => {
    service = new LikeService();
  });

  test('returns true from cache when cached value is "true"', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue('true') });
    getRedisClient.mockReturnValue(redis);

    const result = await service.checkIfLiked(makeId(1), makeId(2));

    expect(result).toBe(true);
    expect(Like.findOne).not.toHaveBeenCalled();
  });

  test('returns false from cache when cached value is "false"', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue('false') });
    getRedisClient.mockReturnValue(redis);

    const result = await service.checkIfLiked(makeId(1), makeId(2));

    expect(result).toBe(false);
    expect(Like.findOne).not.toHaveBeenCalled();
  });

  test('queries database on cache miss', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
    getRedisClient.mockReturnValue(redis);
    Like.findOne.mockResolvedValue({ _id: makeId(9) });

    await service.checkIfLiked(makeId(1), makeId(2));

    expect(Like.findOne).toHaveBeenCalledWith({
      fromUser: makeId(1),
      toUser: makeId(2),
    });
  });

  test('returns true when like exists in database', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
    getRedisClient.mockReturnValue(redis);
    Like.findOne.mockResolvedValue({ _id: makeId(9) });

    const result = await service.checkIfLiked(makeId(1), makeId(2));

    expect(result).toBe(true);
  });

  test('returns false when like does not exist in database', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
    getRedisClient.mockReturnValue(redis);
    Like.findOne.mockResolvedValue(null);

    const result = await service.checkIfLiked(makeId(1), makeId(2));

    expect(result).toBe(false);
  });

  test('caches database result with 1 hour TTL', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
    getRedisClient.mockReturnValue(redis);
    Like.findOne.mockResolvedValue({ _id: makeId(9) });

    await service.checkIfLiked(makeId(1), makeId(2));

    expect(redis.setEx).toHaveBeenCalledWith(
      `like:${makeId(1)}:${makeId(2)}`,
      3600,
      'true'
    );
  });

  test('caches false result when no like found', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
    getRedisClient.mockReturnValue(redis);
    Like.findOne.mockResolvedValue(null);

    await service.checkIfLiked(makeId(1), makeId(2));

    expect(redis.setEx).toHaveBeenCalledWith(
      `like:${makeId(1)}:${makeId(2)}`,
      3600,
      'false'
    );
  });

  test('uses correct cache key format', async () => {
    const userId = makeId(1);
    const profileId = makeId(2);
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
    getRedisClient.mockReturnValue(redis);
    Like.findOne.mockResolvedValue(null);

    await service.checkIfLiked(userId, profileId);

    expect(redis.get).toHaveBeenCalledWith(`like:${userId}:${profileId}`);
  });

  test('returns false on error', async () => {
    getRedisClient.mockImplementation(() => {
      throw new Error('Redis unavailable');
    });

    const result = await service.checkIfLiked(makeId(1), makeId(2));

    expect(result).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validateLikeRequest middleware
// ════════════════════════════════════════════════════════════════════════════

describe('validateLikeRequest middleware', () => {
  const makeRes = () => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  // The error-handler is always the last element of the array
  const errorHandler = validateLikeRequest[validateLikeRequest.length - 1];

  test('calls next() when there are no validation errors', () => {
    validationResult.mockReturnValue({ isEmpty: () => true });
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    errorHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 400 with error details when validation fails', () => {
    const errors = [{ msg: 'Invalid profile ID', param: 'profileId' }];
    validationResult.mockReturnValue({ isEmpty: () => false, array: () => errors });
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    errorHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: errors,
    });
    expect(next).not.toHaveBeenCalled();
  });
});
