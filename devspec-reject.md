# Developer Specification: Reject (Nope) Feature — Backend

**Version:** 2.0
**Date:** 2025-01-01
**Author(s):** CS485 Team
**Role(s):** Backend Developers
**Scope:** Backend REST API only. Frontend animation and DOM logic are out of scope.

---

## Table of Contents

1. [Architecture Diagram](#1-architecture-diagram)
2. [Class Diagram](#2-class-diagram)
3. [List of Classes](#3-list-of-classes)
4. [State Diagrams](#4-state-diagrams)
5. [Flow Charts](#5-flow-charts)
6. [Possible Threats and Failures](#6-possible-threats-and-failures)
7. [Technologies](#7-technologies)
8. [APIs](#8-apis)
9. [Public Interfaces](#9-public-interfaces)
10. [Data Schemas](#10-data-schemas)
11. [Risks to Completion](#11-risks-to-completion)
12. [Security and Privacy](#12-security-and-privacy)

---

## 1. Architecture Diagram

Full request path for a nope action. **No match check occurs for nope** — MatchService is explicitly excluded from this flow (DS-NOPE-1.NOTE).

```
                          POST /api/swipes  {action:"nope"}
  ┌───────────────┐       ──────────────────────────────────►  ┌────────────────────┐
  │  DS-NOPE-1.1  │                                            │   DS-NOPE-1.2      │
  │    Client     │                                            │  Express Router    │
  │ (HTTP caller) │◄── JSON response (201 / 409 / 4xx / 5xx) ─│  /api/swipes       │
  └───────────────┘                                            └────────┬───────────┘
                                                                        │
                                                                        ▼
                                                             ┌────────────────────┐
                                                             │   DS-NOPE-1.3      │
                                                             │  AuthMiddleware    │
                                                             │  (JWT validation)  │
                                                             └────────┬───────────┘
                                                                      │ attach req.user
                                                                      ▼
                                                             ┌────────────────────┐
                                                             │   DS-NOPE-1.4      │
                                                             │  SwipeController   │
                                                             │  (input validation)│
                                                             └────────┬───────────┘
                                                                      │
                                                                      ▼
                                                             ┌────────────────────┐
                                                             │   DS-NOPE-1.5      │
                                                             │   SwipeService     │
                                                             │  (business logic)  │
                                                             └──────┬──────┬──────┘
                                                                    │      │
                                                     ┌──────────────┘      └──────────────┐
                                                     ▼                                    ▼
                                          ┌──────────────────┐              ┌──────────────────────┐
                                          │  DS-NOPE-1.6     │              │  DS-NOPE-1.7         │
                                          │ SwipeRepository  │              │  UserRepository      │
                                          │ (swipes table)   │              │  (users table)       │
                                          └────────┬─────────┘              └──────────────────────┘
                                                   │
                                                   ▼
                                          ┌──────────────────┐
                                          │  DS-NOPE-1.8     │
                                          │   PostgreSQL     │
                                          │  (persistent DB) │
                                          └──────────────────┘

  ┌──────────────────────────────────────────────────────────────────────┐
  │ DS-NOPE-1.NOTE  MatchService is NOT invoked for action="nope".       │
  │ No match record is created. No match notification is triggered.      │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Class Diagram

All backend modules/classes involved in the nope flow.

```
  ┌──────────────────────────────────────────┐
  │         DS-NOPE-C1: Router               │
  │  src/routes/swipes.js                    │
  ├──────────────────────────────────────────┤
  │  + router: Express.Router                │
  ├──────────────────────────────────────────┤
  │  + POST /api/swipes                      │
  │      → authMiddleware                    │
  │      → rateLimitMiddleware               │
  │      → SwipeController.createSwipe()     │
  └──────────────────┬───────────────────────┘
                     │ uses
                     ▼
  ┌──────────────────────────────────────────┐
  │      DS-NOPE-C2: AuthMiddleware          │
  │  src/middleware/auth.js                  │
  ├──────────────────────────────────────────┤
  │  - jwtSecret: string                     │
  ├──────────────────────────────────────────┤
  │  + validate(req, res, next): void        │
  │      reads Authorization header         │
  │      verifies JWT, attaches req.user    │
  └──────────────────────────────────────────┘

  ┌──────────────────────────────────────────┐
  │    DS-NOPE-C3: SwipeController           │
  │  src/controllers/SwipeController.js      │
  ├──────────────────────────────────────────┤
  │  - swipeService: SwipeService            │
  ├──────────────────────────────────────────┤
  │  + createSwipe(req, res): Promise<void>  │
  │      validates body (targetUserId,       │
  │        action enum)                      │
  │      delegates to SwipeService           │
  └──────────────────┬───────────────────────┘
                     │ calls
                     ▼
  ┌──────────────────────────────────────────┐
  │      DS-NOPE-C4: SwipeService            │
  │  src/services/SwipeService.js            │
  ├──────────────────────────────────────────┤
  │  - swipeRepo: SwipeRepository            │
  │  - userRepo:  UserRepository             │
  ├──────────────────────────────────────────┤
  │  + recordNope(swiperId, targetId):       │
  │      Promise<SwipeResult>                │
  │      1. verify target user exists        │
  │      2. prevent self-swipe               │
  │      3. insert swipe record (action=nope)│
  │      4. NO match check (nope path)       │
  └──────────┬──────────────┬───────────────┘
             │ calls        │ calls
             ▼              ▼
  ┌─────────────────┐  ┌────────────────────────┐
  │ DS-NOPE-C5:     │  │ DS-NOPE-C6:            │
  │ SwipeRepository │  │ UserRepository         │
  │ src/repos/      │  │ src/repos/             │
  │ SwipeRepo.js    │  │ UserRepo.js            │
  ├─────────────────┤  ├────────────────────────┤
  │ - pool: Pool    │  │ - pool: Pool           │
  ├─────────────────┤  ├────────────────────────┤
  │ + insertSwipe(  │  │ + findById(id):        │
  │   swiperId,     │  │   Promise<User|null>   │
  │   targetId,     │  └────────────────────────┘
  │   action):      │
  │   Promise<Swipe>│
  │ + findSwipe(    │
  │   swiperId,     │
  │   targetId):    │
  │   Promise<      │
  │   Swipe|null>   │
  └─────────────────┘

  ┌──────────────────────────────────────────┐
  │    DS-NOPE-C7: RateLimitMiddleware       │
  │  src/middleware/rateLimit.js             │
  ├──────────────────────────────────────────┤
  │  - windowMs: number (60_000)             │
  │  - max: number (100)                     │
  ├──────────────────────────────────────────┤
  │  + limiter: express-rate-limit handler   │
  └──────────────────────────────────────────┘
```

---

## 3. List of Classes

| Label | Name | File Path | Purpose |
|-------|------|-----------|---------|
| DS-NOPE-C1 | Router | src/routes/swipes.js | Registers `POST /api/swipes`; chains middleware and controller |
| DS-NOPE-C2 | AuthMiddleware | src/middleware/auth.js | Validates JWT bearer token; attaches decoded user to `req.user` |
| DS-NOPE-C3 | SwipeController | src/controllers/SwipeController.js | Parses and validates HTTP request; delegates to SwipeService; returns HTTP response |
| DS-NOPE-C4 | SwipeService | src/services/SwipeService.js | Encapsulates business logic: target existence check, self-swipe guard, nope persistence; explicitly skips match logic |
| DS-NOPE-C5 | SwipeRepository | src/repos/SwipeRepo.js | Executes parameterized SQL against the `swipes` table; surfaces unique-constraint errors |
| DS-NOPE-C6 | UserRepository | src/repos/UserRepo.js | Queries the `users` table to verify a target user exists |
| DS-NOPE-C7 | RateLimitMiddleware | src/middleware/rateLimit.js | Throttles swipe requests per IP/user to prevent abuse |

---

## 4. State Diagrams

### 4.1 Swipe Record Lifecycle

```
  ┌───────────────────────┐
  │  DS-NOPE-S1: PENDING  │  Request received; transaction not yet committed
  └───────────┬───────────┘
              │  SwipeService validates: target exists, not self, action=nope
              ▼
  ┌───────────────────────┐
  │ DS-NOPE-S2: RECORDING │  INSERT INTO swipes executing
  └───────────┬───────────┘
              │  INSERT succeeds (no UNIQUE violation)
              ▼
  ┌───────────────────────────┐
  │ DS-NOPE-S3: RECORDED      │  Row persisted: action='nope', created_at=NOW()
  └───────────┬───────────────┘
              │  action = 'nope' → match evaluation SKIPPED
              ▼
  ┌───────────────────────────────────┐
  │ DS-NOPE-S4: MATCH_SKIPPED (final) │  No match record created. Response 201 sent.
  └───────────────────────────────────┘

  NOTE (DS-NOPE-S.NOTE): For action='like' or 'superlike', the flow would
  continue from DS-NOPE-S3 into MatchService. That branch does NOT exist
  in the nope path.
```

### 4.2 Idempotency State Machine

```
  ┌────────────────────────┐
  │ DS-NOPE-I1: FIRST_NOPE │  No prior swipe record exists for (swiperId, targetId)
  └────────────┬───────────┘
               │  INSERT succeeds
               ▼
  ┌──────────────────────────────┐
  │ DS-NOPE-I2: NOPE_RECORDED    │  Row committed; HTTP 201 returned
  └──────────────────────────────┘

  ┌──────────────────────────────────┐
  │ DS-NOPE-I3: DUPLICATE_NOPE       │  Same (swiperId, targetId) submitted again
  └────────────┬─────────────────────┘
               │  INSERT hits UNIQUE constraint violation (pg error code 23505)
               ▼
  ┌──────────────────────────────────┐
  │ DS-NOPE-I4: CONFLICT (final)     │  HTTP 409 Conflict returned; no DB mutation
  └──────────────────────────────────┘

  Implementation note (DS-NOPE-I.NOTE):
  The UNIQUE(swiper_id, target_id) constraint on the swipes table provides
  atomicity under concurrent requests — even if two identical nope requests
  arrive simultaneously, exactly one INSERT will succeed and the other will
  receive error code 23505.
```

---

## 5. Flow Charts

### FC-1: Happy Path — Authenticated User Sends POST /api/swipes (action=nope)

```
  [DS-NOPE-FC1-START] Client sends POST /api/swipes
            │  Authorization: Bearer <token>
            │  Body: { targetUserId: "uuid", action: "nope" }
            ▼
  ┌─────────────────────────────────┐
  │ DS-NOPE-FC1-1: AuthMiddleware   │
  │ Verify JWT signature & expiry   │
  └──────────┬──────────────────────┘
             │ Valid?
      ┌──────┴──────┐
      │ No          │ Yes
      ▼             ▼
  [401 Unauth]  ┌──────────────────────────────────┐
                │ DS-NOPE-FC1-2: RateLimitMiddleware│
                │ Check request count for user/IP   │
                └──────────┬───────────────────────┘
                           │ Within limit?
                    ┌──────┴──────┐
                    │ No          │ Yes
                    ▼             ▼
                [429 Too     ┌──────────────────────────────────┐
                 Many Req]   │ DS-NOPE-FC1-3: SwipeController   │
                             │ Validate body schema:            │
                             │  - targetUserId: non-empty UUID  │
                             │  - action: must be enum value    │
                             └──────────┬───────────────────────┘
                                        │ Valid?
                                 ┌──────┴──────┐
                                 │ No          │ Yes
                                 ▼             ▼
                             [400 Bad    ┌──────────────────────────────────┐
                              Request]   │ DS-NOPE-FC1-4: SwipeService      │
                                         │ Check targetUserId != swiperId   │
                                         └──────────┬───────────────────────┘
                                                    │ Self-swipe?
                                             ┌──────┴──────┐
                                             │ Yes         │ No
                                             ▼             ▼
                                         [403 Forb.  ┌──────────────────────────────────┐
                                          self-swipe] │ DS-NOPE-FC1-5: UserRepository   │
                                                      │ SELECT * FROM users WHERE id=?  │
                                                      └──────────┬───────────────────────┘
                                                                 │ Target exists?
                                                          ┌──────┴──────┐
                                                          │ No          │ Yes
                                                          ▼             ▼
                                                       [404 Not   ┌──────────────────────────────────┐
                                                        Found]    │ DS-NOPE-FC1-6: SwipeRepository   │
                                                                  │ INSERT INTO swipes               │
                                                                  │  (swiper_id, target_id, action)  │
                                                                  │  VALUES (?, ?, 'nope')           │
                                                                  └──────────┬───────────────────────┘
                                                                             │ Success?
                                                                      ┌──────┴──────┐
                                                                      │ No (DB err) │ Yes
                                                                      ▼             ▼
                                                                  [500 Internal  ┌─────────────────────────────┐
                                                                   Server Error] │ DS-NOPE-FC1-7:              │
                                                                                 │ NO match check performed.   │
                                                                                 │ Return HTTP 201 Created     │
                                                                                 │ { swipeId, action, created }│
                                                                                 └─────────────────────────────┘
```

---

### FC-2: Duplicate Nope Attempt

```
  [DS-NOPE-FC2-START] Authenticated user submits POST /api/swipes (action=nope)
         │  for a (swiperId, targetId) pair that already exists
         ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC2-1: Auth + validation pass    │
  │ (same as FC-1 steps 1–5)                 │
  └───────────────────┬──────────────────────┘
                      ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC2-2: SwipeRepository           │
  │ INSERT INTO swipes ...                   │
  │ PostgreSQL raises error code 23505       │
  │ (unique_violation on swiper_id+target_id)│
  └───────────────────┬──────────────────────┘
                      ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC2-3: SwipeService              │
  │ Catch pg error; inspect code === '23505' │
  └───────────────────┬──────────────────────┘
                      ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC2-4: SwipeController           │
  │ Return HTTP 409 Conflict                 │
  │ { error: "Already noped this profile" }  │
  └──────────────────────────────────────────┘
```

---

### FC-3: Nope When Target User Does Not Exist

```
  [DS-NOPE-FC3-START] Authenticated user submits POST /api/swipes
         │  { targetUserId: "non-existent-uuid", action: "nope" }
         ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC3-1: Auth + rate limit pass    │
  └───────────────────┬──────────────────────┘
                      ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC3-2: SwipeController           │
  │ Body schema validation passes            │
  │ (UUID format is valid)                   │
  └───────────────────┬──────────────────────┘
                      ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC3-3: SwipeService              │
  │ Check swiperId != targetId: OK           │
  └───────────────────┬──────────────────────┘
                      ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC3-4: UserRepository            │
  │ SELECT id FROM users WHERE id = ?        │
  │ → returns 0 rows                         │
  └───────────────────┬──────────────────────┘
                      ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC3-5: SwipeService              │
  │ target === null → throw NotFoundError    │
  └───────────────────┬──────────────────────┘
                      ▼
  ┌──────────────────────────────────────────┐
  │ DS-NOPE-FC3-6: SwipeController           │
  │ Catch NotFoundError                      │
  │ Return HTTP 404 Not Found                │
  │ { error: "Target user not found" }       │
  └──────────────────────────────────────────┘
```

---

## 6. Possible Threats and Failures

| Label | Failure Mode | Effect | Likelihood | Impact | Recovery |
|-------|-------------|--------|------------|--------|----------|
| DS-NOPE-T1 | PostgreSQL connection failure / pool exhaustion | `INSERT` throws; swipe not recorded; 500 returned to client | Low | High | pg pool retries on reconnect; return 503 with Retry-After header; alert on-call |
| DS-NOPE-T2 | Duplicate nope race condition (two concurrent identical requests) | Both hit INSERT simultaneously; one succeeds (201), one gets UNIQUE violation (409) | Low-Medium | Low | DB-level `UNIQUE(swiper_id, target_id)` constraint is the authoritative guard; no application-level lock needed |
| DS-NOPE-T3 | JWT expired or tampered | AuthMiddleware rejects token; 401 returned; no DB access attempted | Medium | Low | Client must re-authenticate and obtain a new token; no server-side state needed |
| DS-NOPE-T4 | Invalid or malformed `targetUserId` (not a UUID) | Input validation in SwipeController rejects body; 400 returned before DB query | Medium | Low | Joi/Zod schema validation; sanitize before any DB interaction |
| DS-NOPE-T5 | User attempts to nope themselves | SwipeService self-swipe guard triggers; 403 returned; no DB write | Low | Low | Explicit `swiperId === targetId` check in SwipeService before any DB call |
| DS-NOPE-T6 | Target user account deleted between existence check and INSERT | Foreign key constraint on `swipes.target_id` → `users.id` causes INSERT to fail; 500 or re-mapped 404 | Very Low | Low | Catch FK violation (pg error 23503); return 404 "Target user not found" |
| DS-NOPE-T7 | Nope accidentally triggering match logic (regression) | Match created incorrectly between two users who should not have matched | Low | High | Unit tests asserting MatchService is never called when action=nope; integration test on nope endpoint verifying matches table unchanged |
| DS-NOPE-T8 | Swipe flooding / profile enumeration attack | Attacker submits nope for every UUID to map active users | Medium | Medium | Per-user rate limit (express-rate-limit); 429 after threshold; consider progressive back-off |

---

## 7. Technologies

| Technology | Version | URL | Why Chosen | Alternatives Considered |
|------------|---------|-----|------------|------------------------|
| Node.js | 20 LTS | https://nodejs.org | Non-blocking I/O ideal for high-concurrency swipe traffic; large ecosystem | Deno, Bun |
| Express | 4.x | https://expressjs.com | Minimal, well-understood HTTP framework; flexible middleware chain | Fastify, Koa, Hapi |
| PostgreSQL | 15+ | https://postgresql.org | ACID transactions; `UNIQUE` constraints prevent duplicate swipes at DB level; mature JSON support | MySQL, SQLite, MongoDB |
| node-postgres (pg) | 8.x | https://node-postgres.com | Official, low-level PostgreSQL driver; connection pooling via `pg.Pool`; reliable error codes | Prisma, Sequelize, Knex |
| jsonwebtoken | 9.x | https://github.com/auth0/node-jsonwebtoken | Compact JWT signing and verification; standard HS256/RS256 support | Passport.js, jose |
| bcrypt | 5.x | https://github.com/kelektiv/node.bcrypt.js | Password hashing at registration/login (not directly in swipe flow, but required by users table) | argon2, scrypt |
| express-rate-limit | 7.x | https://github.com/express-rate-limit/express-rate-limit | Simple per-IP/per-user rate limiting middleware; prevents swipe flooding | nginx rate limiting, custom Redis bucket |
| Joi / Zod | 17.x / 3.x | https://joi.dev / https://zod.dev | Schema-based input validation; prevents malformed UUIDs reaching the DB | Manual validation, express-validator |

---

## 8. APIs

### POST /api/swipes

**Record a swipe action (including nope) for the authenticated user.**

| Field | Value |
|-------|-------|
| Method | `POST` |
| Path | `/api/swipes` |
| Auth Required | Yes — `Authorization: Bearer <JWT>` |
| Rate Limited | Yes — 100 requests per minute per user |

**Request Body** (Content-Type: application/json)

```json
{
  "targetUserId": "550e8400-e29b-41d4-a716-446655440000",
  "action": "nope"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `targetUserId` | UUID string | Yes | Valid UUID v4; must not equal authenticated user's ID |
| `action` | enum string | Yes | One of: `"like"`, `"nope"`, `"superlike"` |

**Success Response — 201 Created**

```json
{
  "swipeId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "swiperId": "a6b3c2d1-...",
  "targetId": "550e8400-...",
  "action": "nope",
  "createdAt": "2025-01-01T12:34:56.789Z"
}
```

**Error Responses**

| HTTP Status | Code | Condition |
|-------------|------|-----------|
| 400 Bad Request | `VALIDATION_ERROR` | Body missing required fields, invalid UUID format, or unrecognized action value |
| 401 Unauthorized | `INVALID_TOKEN` | Missing, expired, or invalid JWT |
| 403 Forbidden | `SELF_SWIPE` | `targetUserId` equals the authenticated user's own ID |
| 404 Not Found | `TARGET_NOT_FOUND` | No user exists with the given `targetUserId` |
| 409 Conflict | `ALREADY_SWIPED` | A swipe record already exists for this (swiperId, targetId) pair |
| 429 Too Many Requests | `RATE_LIMITED` | Swipe rate limit exceeded |
| 500 Internal Server Error | `SERVER_ERROR` | Unexpected database or server failure |

**Error Response Body Shape**

```json
{
  "error": "Already noped this profile",
  "code": "ALREADY_SWIPED"
}
```

---

## 9. Public Interfaces

These are the method signatures called across module boundaries.

| Label | Caller | Method Signature | Callee | Notes |
|-------|--------|-----------------|--------|-------|
| DS-NOPE-PI1 | Router (DS-NOPE-C1) | `authMiddleware(req, res, next)` | AuthMiddleware (DS-NOPE-C2) | Attaches `req.user = { id, email }` on success |
| DS-NOPE-PI2 | Router (DS-NOPE-C1) | `limiter(req, res, next)` | RateLimitMiddleware (DS-NOPE-C7) | Returns 429 if threshold exceeded |
| DS-NOPE-PI3 | Router (DS-NOPE-C1) | `createSwipe(req, res)` | SwipeController (DS-NOPE-C3) | Entry point for all swipe types including nope |
| DS-NOPE-PI4 | SwipeController (DS-NOPE-C3) | `recordNope(swiperId: string, targetId: string): Promise<SwipeResult>` | SwipeService (DS-NOPE-C4) | Throws `NotFoundError`, `SelfSwipeError`, or `DuplicateSwipeError` |
| DS-NOPE-PI5 | SwipeService (DS-NOPE-C4) | `findById(id: string): Promise<User \| null>` | UserRepository (DS-NOPE-C6) | Returns `null` if user does not exist |
| DS-NOPE-PI6 | SwipeService (DS-NOPE-C4) | `insertSwipe(swiperId: string, targetId: string, action: string): Promise<Swipe>` | SwipeRepository (DS-NOPE-C5) | Throws pg error 23505 on duplicate |
| DS-NOPE-PI7 | SwipeService (DS-NOPE-C4) | `findSwipe(swiperId: string, targetId: string): Promise<Swipe \| null>` | SwipeRepository (DS-NOPE-C5) | Used in explicit duplicate check if preferred over catching 23505 |

**SwipeResult type** (DS-NOPE-PI.TYPE):
```typescript
interface SwipeResult {
  swipeId: string;
  swiperId: string;
  targetId: string;
  action: 'like' | 'nope' | 'superlike';
  createdAt: Date;
  matched: false;  // always false for action='nope'
}
```

---

## 10. Data Schemas

### PostgreSQL DDL

```sql
-- DS-NOPE-DB1: users table
-- Stores authenticated user accounts.
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX DS_NOPE_IDX1_users_email ON users (email);


-- DS-NOPE-DB2: swipes table
-- Records every swipe action. UNIQUE(swiper_id, target_id) ensures
-- a user can only swipe each target once, regardless of action type.
-- This constraint also prevents duplicate nopes at the database level
-- under concurrent requests.
CREATE TABLE swipes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swiper_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     VARCHAR(10) NOT NULL CHECK (action IN ('like', 'nope', 'superlike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_swiper_target UNIQUE (swiper_id, target_id)
);

CREATE INDEX DS_NOPE_IDX2_swipes_swiper  ON swipes (swiper_id);
CREATE INDEX DS_NOPE_IDX3_swipes_target  ON swipes (target_id);
CREATE INDEX DS_NOPE_IDX4_swipes_action  ON swipes (action);
```

> **DS-NOPE-DB.NOTE — matches table:**
> A `matches` table is **NOT** created or updated by the nope flow.
> When `action = 'nope'`, SwipeService explicitly skips all match evaluation logic.
> Even if the target user had previously liked the swiper, a nope from the swiper
> must never result in a match record being inserted. This is enforced at the
> service layer (no call to MatchService) and should be covered by integration
> tests that verify the matches table is unchanged after a nope.

---

## 11. Risks to Completion

| Label | Component | Risk Category | Difficulty | Notes |
|-------|-----------|--------------|------------|-------|
| DS-NOPE-R1 | SwipeService | Regression — nope must never create a match | Medium | If MatchService is refactored to run on all swipes, the nope guard could be silently broken. Requires unit test asserting MatchService is never called when action=nope. |
| DS-NOPE-R2 | SwipeRepository | Idempotency — duplicate nope handling | Low | UNIQUE constraint in DB is the safety net, but the error code (23505) must be correctly caught and re-mapped to 409. If error handling is generic, 23505 may surface as 500. |
| DS-NOPE-R3 | RateLimitMiddleware | Rate limiting configuration | Low | Default in-memory store for express-rate-limit does not work across multiple server instances. Must use a Redis store for multi-instance deployments. |
| DS-NOPE-R4 | AuthMiddleware | JWT secret management | Medium | JWT secret must be stored in environment variables, not hardcoded. Rotation strategy needed; token expiry should be short (15–60 min) with refresh tokens for production. |
| DS-NOPE-R5 | UserRepository | Target user existence check vs. concurrent delete | Very Low | Target user could be deleted between existence check and INSERT. FK constraint on `swipes.target_id` will catch this; map pg error 23503 to 404 in service layer. |
| DS-NOPE-R6 | Database | Schema migration coordination | Low | `UNIQUE(swiper_id, target_id)` constraint means a user cannot change a nope to a like later. Confirm with product whether swipe reversal is a required feature before migration is run. |
| DS-NOPE-R7 | SwipeController | Input validation completeness | Low | Must validate both `targetUserId` is a valid UUID and `action` is an accepted enum. Partial validation (e.g., only checking action) allows SQL-injection-adjacent payloads if parameterized queries are ever bypassed. |

---

## 12. Security and Privacy

### 12.1 PII Stored

| Data Element | Table | Stored As | Retention | Protection | Disposal |
|-------------|-------|-----------|-----------|------------|----------|
| Email address | `users.email` | Plaintext (VARCHAR) | Until account deletion | DB-level access control; TLS in transit | `DELETE FROM users WHERE id = ?` on account deletion; cascades to swipes |
| Password | `users.password_hash` | bcrypt hash (cost ≥ 12) | Until account deletion | Never logged; never returned in API responses | Same cascade as above |
| Swipe history | `swipes` | UUID references + action enum | Until account deletion | No PII beyond user IDs; not exposed in nope response payload | Cascade delete when `swiper_id` or `target_id` user is deleted |

**DS-NOPE-SEC1.NOTE:** The nope endpoint itself does not collect or return sensitive PII. The response body contains only UUIDs, the action string, and a timestamp. Email addresses and display names are never included in swipe API responses.

---

### 12.2 Authentication (DS-NOPE-SEC2)

- All requests to `POST /api/swipes` must include `Authorization: Bearer <token>`.
- AuthMiddleware verifies the JWT signature using the server-side secret (`JWT_SECRET` env var, ≥ 256-bit random value).
- Tokens must include `exp` (expiry) claim. Tokens are rejected if expired.
- Decoded payload must contain `sub` (user ID) which maps to `req.user.id`.
- If token is missing, malformed, or expired, AuthMiddleware returns **401** before any DB access occurs.
- Token secrets must never be hardcoded; loaded from environment variables only.

---

### 12.3 Authorization (DS-NOPE-SEC3)

- A user may only record swipes as themselves. `req.user.id` (from verified JWT) is always used as `swiperId` — the client cannot supply a different swiperId in the request body.
- **Self-swipe prevention:** SwipeService checks `swiperId === targetId` and throws a `SelfSwipeError` (HTTP 403) before any DB write.
- There is no admin-bypass route for the nope action; authorization is uniform for all authenticated users.

---

### 12.4 Rate Limiting (DS-NOPE-SEC4)

- `express-rate-limit` middleware is applied to `POST /api/swipes` before the controller.
- Default limit: **100 requests per 60-second window per authenticated user ID** (keyed on `req.user.id`, not raw IP, to prevent bypass via proxy).
- Exceeding the limit returns HTTP **429 Too Many Requests** with a `Retry-After` header.
- For multi-instance deployments, the rate limiter must use a shared Redis store (`rate-limit-redis`) rather than the default in-memory store.
- Purpose: prevents profile-enumeration attacks (submitting nope for every UUID to discover active users) and denial-of-service via write flooding.

---

### 12.5 Injection and Input Validation (DS-NOPE-SEC5)

- All SQL queries in SwipeRepository and UserRepository use **parameterized queries** via `node-postgres` (`$1, $2, ...` placeholders). String concatenation into SQL is prohibited.
- Input validation occurs in SwipeController before any service call:
  - `targetUserId` must match UUID v4 regex (or validated by Joi/Zod schema).
  - `action` must be one of the accepted enum values (`like`, `nope`, `superlike`).
- Requests failing validation are rejected with **400 Bad Request** before reaching the database layer.
- PostgreSQL `CHECK (action IN ('like', 'nope', 'superlike'))` provides a second-layer defense against invalid action values.

---

### 12.6 Concurrency and Race Conditions (DS-NOPE-SEC6)

- **Problem:** Two identical nope requests from the same user could arrive at the server simultaneously, both pass the application-level duplicate check, and both attempt to INSERT.
- **Solution:** The `UNIQUE(swiper_id, target_id)` constraint on the `swipes` table is evaluated atomically by PostgreSQL. Exactly one INSERT will succeed; the other will receive error code **23505** (`unique_violation`). The service layer catches this and returns **409 Conflict**.
- No application-level mutex or advisory lock is required. The DB constraint is the authoritative concurrency guard.
- This guarantee holds even across multiple horizontally-scaled Node.js processes, as all share the same PostgreSQL instance.
- **No match race risk for nope:** because MatchService is never called on the nope path, there is no risk of a concurrent match-creation race condition.
