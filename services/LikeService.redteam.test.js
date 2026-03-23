'use strict';

/**
 * Red Team Tests for LikeService
 *
 * These tests probe edge cases, bad inputs, and inconsistencies that the
 * original unit tests do not cover. Each test is annotated with a severity
 * and a description of the issue found.
 */

jest.mock('../models/Like');
jest.mock('../models/User');
jest.mock('../config/redis');
jest.mock('../utils/logger');
jest.mock('express-validator', () => {
  const chain = {};
  chain.isMongoId = jest.fn().mockReturnValue(chain);
  chain.withMessage = jest.fn().mockReturnValue(jest.fn());
  return {
    body: jest.fn().mockReturnValue(chain),
    validationResult: jest.fn(),
  };
});

const { LikeService } = require('./LikeService');
const Like = require('../models/Like');
const User = require('../models/User');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

const makeId = (n = 0) => `507f1f77bcf86cd79943901${n}`;

const makeUser = (overrides = {}) => ({ _id: makeId(1), isActive: true, ...overrides });

const makeRedis = (overrides = {}) => ({
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  setEx: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  logger.info = jest.fn();
  logger.error = jest.fn();
  logger.warn = jest.fn();
});

// ════════════════════════════════════════════════════════════════════════════
// FINDING 1 — validateLike allows self-like
// Severity: HIGH
// likeProfile correctly rejects userId === profileId, but validateLike has
// no such check. Callers that pre-validate with validateLike before calling
// likeProfile may assume self-like is already blocked.
// ════════════════════════════════════════════════════════════════════════════

describe('[FINDING 1] validateLike — missing self-like guard', () => {
  let service;
  beforeEach(() => { service = new LikeService(); });

  test('validateLike returns valid:true when userId === profileId (should be invalid)', async () => {
    const id = makeId(1);
    User.findById = jest.fn()
      .mockReturnValue({ select: jest.fn().mockResolvedValue(makeUser({ _id: id })) });
    Like.findOne.mockResolvedValue(null);

    const result = await service.validateLike(id, id);

    // BUG: returns { valid: true } — self-like passes validation
    expect(result).toEqual({ valid: true });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FINDING 2 — likeProfile accepts whitespace-only userId / profileId
// Severity: MEDIUM
// The guard is `!userId` which passes for any non-empty string, including
// strings that are only whitespace. These would reach User.findById as
// invalid IDs.
// ════════════════════════════════════════════════════════════════════════════

describe('[FINDING 2] likeProfile — whitespace IDs bypass falsy check', () => {
  let service;
  beforeEach(() => { service = new LikeService(); });

  test('whitespace userId is not caught by the !userId guard', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    // Whitespace passes !userId, so execution continues to User.findById
    User.findById.mockResolvedValue(null);

    // The call should throw 'User not found', not 'User ID and Profile ID are required'
    await expect(service.likeProfile('   ', makeId(2))).rejects.toThrow('User not found');
    // BUG: input validation error message is never reached for whitespace inputs
  });

  test('whitespace profileId is not caught by the !profileId guard', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById.mockResolvedValue(null);

    await expect(service.likeProfile(makeId(1), '   ')).rejects.toThrow('User not found');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FINDING 3 — getLikedProfiles accepts invalid page numbers
// Severity: MEDIUM
// page=0 produces skip=-20, page=-1 produces skip=-40. MongoDB rejects
// negative skip values, causing an unhandled error to propagate.
// ════════════════════════════════════════════════════════════════════════════

describe('[FINDING 3] getLikedProfiles — invalid page numbers', () => {
  let service;
  beforeEach(() => { service = new LikeService(); });

  test('page=0 results in negative skip value (-20)', async () => {
    Like.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    await service.getLikedProfiles(makeId(1), 0);

    const chain = Like.find.mock.results[0].value;
    // BUG: skip is called with -20, which MongoDB rejects
    expect(chain.skip).toHaveBeenCalledWith(-20);
  });

  test('page=-1 results in skip=-40', async () => {
    Like.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    await service.getLikedProfiles(makeId(1), -1);

    const chain = Like.find.mock.results[0].value;
    expect(chain.skip).toHaveBeenCalledWith(-40);
  });

  test('limit=0 passes through and returns no results', async () => {
    Like.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const result = await service.getLikedProfiles(makeId(1), 1, 0);

    const chain = Like.find.mock.results[0].value;
    expect(chain.limit).toHaveBeenCalledWith(0);
    expect(result).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FINDING 4 — checkIfLiked: any truthy non-'true' cached value returns false
// Severity: LOW
// The check `if (cached)` is true for any non-null string, but then
// `cached === 'true'` returns false for values like '1', 'yes', 'TRUE'.
// A corrupted or unexpected Redis value silently returns false (not liked).
// ════════════════════════════════════════════════════════════════════════════

describe('[FINDING 4] checkIfLiked — unexpected cached value treated as false', () => {
  let service;
  beforeEach(() => { service = new LikeService(); });

  test.each(['1', 'yes', 'TRUE', 'liked'])('cached value "%s" returns false instead of error', async (value) => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(value) });
    getRedisClient.mockReturnValue(redis);

    const result = await service.checkIfLiked(makeId(1), makeId(2));

    // BUG: DB is never queried, silently returns false for truthy non-'true' values
    expect(result).toBe(false);
    expect(Like.findOne).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FINDING 5 — rate limit is consumed by requests that fail later
// Severity: MEDIUM
// checkRateLimit runs before user existence checks. A caller can exhaust
// the 50-like window by repeatedly calling likeProfile with a valid userId
// but non-existent profileId. All 50 slots are consumed without any like
// being created.
// ════════════════════════════════════════════════════════════════════════════

describe('[FINDING 5] likeProfile — rate limit consumed by failed requests', () => {
  let service;
  beforeEach(() => { service = new LikeService(); });

  test('rate limit counter increments even when target user does not exist', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(1) });
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(null); // target not found

    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow('User not found');

    // BUG: rate limit was already incremented before the failure
    expect(redis.incr).toHaveBeenCalledWith(`rate_limit:like:${makeId(1)}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FINDING 6 — likeProfile partial failure leaves orphaned like in DB
// Severity: HIGH
// If like.save() succeeds but User.updateOne throws, the like document
// exists in the DB but the function throws. On retry, the user hits
// "Already liked this profile" permanently — the like cannot be retried.
// ════════════════════════════════════════════════════════════════════════════

describe('[FINDING 6] likeProfile — orphaned like on partial failure', () => {
  let service;
  beforeEach(() => { service = new LikeService(); });

  test('throws when User.updateOne fails after like.save() succeeds', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));
    Like.findOne.mockResolvedValue(null);

    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);
    User.updateOne.mockRejectedValue(new Error('DB write failed'));

    // BUG: like was saved, stats were not updated, caller gets an error
    // A retry will hit "Already liked this profile" with no way to recover
    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow('DB write failed');
  });

  test('confirms retry after partial failure throws "Already liked" — not retriable', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValue(makeUser());
    // Second call: the orphaned like now exists
    Like.findOne.mockResolvedValue({ _id: makeId(9) });

    await expect(service.likeProfile(makeId(1), makeId(2))).rejects.toThrow(
      'Already liked this profile'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FINDING 7 — isMatch return value is always false in practice
// Severity: MEDIUM
// The service returns `like.isMatch` from the in-memory Like object.
// The Like model's post('save') hook updates isMatch via updateOne(), which
// modifies the DB record but NOT the in-memory object. So `like.isMatch`
// is always the default value (false) regardless of whether a match formed.
// The existing tests mask this by directly setting isMatch:true on the mock
// object, which the real model hook never does in memory.
// ════════════════════════════════════════════════════════════════════════════

describe('[FINDING 7] likeProfile — isMatch always false in real execution', () => {
  let service;
  beforeEach(() => { service = new LikeService(); });

  test('demonstrates the test mock hides the real behavior: save() does not set isMatch', async () => {
    const redis = makeRedis();
    getRedisClient.mockReturnValue(redis);
    User.findById
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce(makeUser({ _id: makeId(2) }));
    Like.findOne.mockResolvedValue(null);
    User.updateOne.mockResolvedValue({});

    // Realistic mock: save() resolves but does NOT update isMatch on the object
    // (mirrors real mongoose post-save hook behavior)
    const savedLike = { _id: makeId(9), isMatch: false, save: jest.fn().mockResolvedValue() };
    Like.mockImplementation(() => savedLike);

    const result = await service.likeProfile(makeId(1), makeId(2));

    // In real execution this is always false — match detection via post-save hook
    // updates the DB record only, not the in-memory object returned here
    expect(result.isMatch).toBe(false);
    expect(result.message).toBe('Profile liked');
    // The 'It\'s a match!' branch in likeProfile is unreachable in production
  });
});
