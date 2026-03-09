# Backend Developer Specification: Super Like Feature
**Project:** AI Tinder App  
**Feature:** Super Like  
**Version:** 1.0.0  
**Date:** 2025-07-09  
**Scope:** Backend only

---

## 1. Architecture Diagram

Full request path from client through all middleware and service layers to the database.

```
DS-SUPERLIKE-1.1
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         POST /api/swipes  (action: "superlike")                 │
└─────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────┐
│  DS-SUPERLIKE-1.2  │   HTTP Layer (Express)
│   Express Router   │   Receives POST /api/swipes
└────────────────────┘
         │
         ▼
┌────────────────────┐
│  DS-SUPERLIKE-1.3  │   Middleware: Auth
│  AuthMiddleware    │   Validates JWT Bearer token
│                    │   Extracts req.userId from payload
│                    │   → 401 if missing/invalid/expired
└────────────────────┘
         │
         ▼
┌────────────────────┐
│  DS-SUPERLIKE-1.4  │   Middleware: Rate Limit
│RateLimitMiddleware │   Per-IP express-rate-limit check
│                    │   (burst abuse prevention, not quota)
│                    │   → 429 if IP exceeds request burst limit
└────────────────────┘
         │
         ▼
┌────────────────────┐
│  DS-SUPERLIKE-1.5  │   Controller
│  SwipeController   │   Validates request body schema
│                    │   Calls SwipeService.recordSwipe()
│                    │   Returns HTTP response
└────────────────────┘
         │
         ▼
┌────────────────────┐
│  DS-SUPERLIKE-1.6  │   Service Orchestration
│   SwipeService     │   Coordinates sub-services
│                    │   Handles transaction boundary
└────────────────────┘
         │
         ├─────────────────────────────────┐
         ▼                                 ▼
┌────────────────────┐         ┌────────────────────┐
│  DS-SUPERLIKE-1.7  │         │  DS-SUPERLIKE-1.8  │
│   QuotaService     │         │  SwipeRepository   │
│                    │         │                    │
│ ◄── QUOTA CHECK    │         │  Writes swipe row  │
│     OCCURS HERE    │         │  (within txn)      │
│     BEFORE any     │         │                    │
│     DB write       │         │                    │
│                    │         │                    │
│ → 429 if exceeded  │         └────────────────────┘
└────────────────────┘                   │
         │                               │
         │ quota OK                      │ swipe recorded
         └─────────────────┬─────────────┘
                           ▼
               ┌────────────────────┐
               │  DS-SUPERLIKE-1.9  │
               │   MatchService     │
               │                   │
               │ Check reverse swipe│
               │ from target user  │
               │ → create match    │
               │   if mutual       │
               └────────────────────┘
                           │
                           ▼
               ┌────────────────────┐
               │  DS-SUPERLIKE-1.10 │
               │   PostgreSQL DB    │
               │                   │
               │  tables:          │
               │  - swipes         │
               │  - matches        │
               │  - users          │
               └────────────────────┘

NOTE (DS-SUPERLIKE-1.N1): The daily quota check (QuotaService) is performed
BEFORE any write to the swipes table. The entire flow — quota check, swipe
insert, and match creation — executes inside a single serializable DB
transaction to prevent race conditions (see Section 12.6).
```

---

## 2. Class Diagram

All backend modules, their fields, and methods.

```
DS-SUPERLIKE-2.0  Module Relationships

┌──────────────────────────────┐
│  DS-SUPERLIKE-C1             │
│  <<module>> router.js        │
│──────────────────────────────│
│  + router: express.Router    │
│──────────────────────────────│
│  + POST /api/swipes          │
│  + GET  /api/swipes/quota    │
└──────────────────────────────┘
         │ uses
         ▼
┌──────────────────────────────┐     ┌──────────────────────────────┐
│  DS-SUPERLIKE-C2             │     │  DS-SUPERLIKE-C3             │
│  <<middleware>>              │     │  <<middleware>>              │
│  AuthMiddleware              │     │  RateLimitMiddleware         │
│──────────────────────────────│     │──────────────────────────────│
│  - jwtSecret: string         │     │  - windowMs: number          │
│──────────────────────────────│     │  - max: number               │
│  + handle(req, res, next)    │     │──────────────────────────────│
│  + extractToken(header)      │     │  + handle(req, res, next)    │
│  + verifyToken(token): Payload│    └──────────────────────────────┘
└──────────────────────────────┘
         │ passes to
         ▼
┌──────────────────────────────┐
│  DS-SUPERLIKE-C4             │
│  <<class>>                   │
│  SwipeController             │
│──────────────────────────────│
│  - swipeService: SwipeService│
│──────────────────────────────│
│  + postSwipe(req, res)       │
│  + getQuota(req, res)        │
│  - validateBody(body): void  │
└──────────────────────────────┘
         │ calls
         ▼
┌──────────────────────────────┐
│  DS-SUPERLIKE-C5             │
│  <<class>>                   │
│  SwipeService                │
│──────────────────────────────│
│  - quotaService: QuotaService│
│  - swipeRepo: SwipeRepository│
│  - matchService: MatchService│
│  - db: Pool                  │
│──────────────────────────────│
│  + recordSwipe(              │
│      swiperId: string,       │
│      targetId: string,       │
│      action: SwipeAction     │
│    ): Promise<SwipeResult>   │
│  + getQuotaStatus(           │
│      userId: string          │
│    ): Promise<QuotaStatus>   │
└──────────────────────────────┘
    │           │           │
    ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────────────────────────┐
│DS-SUPERLIKE│ │DS-SUPERLIKE│ │  DS-SUPERLIKE-C8             │
│   -C6    │ │   -C7    │ │  <<class>>                   │
│QuotaService│ │SwipeRepo.│ │  MatchService                │
│──────────│ │──────────│ │──────────────────────────────│
│- db: Pool│ │- db: Pool│ │  - db: Pool                  │
│──────────│ │──────────│ │──────────────────────────────│
│+checkQuota│ │+create   │ │  + checkAndCreateMatch(      │
│ (userId, │ │ Swipe(   │ │      swiperId: string,       │
│  client) │ │  data,   │ │      targetId: string,       │
│ :Quota   │ │  client) │ │      client: PoolClient      │
│+consume  │ │+findSwipe│ │    ): Promise<Match|null>    │
│ Quota(   │ │ (swiperId│ │  - hasLikedOrSuperliked(     │
│  userId, │ │  targetId│ │      userId: string,         │
│  client) │ │  client) │ │      targetId: string,       │
│:void     │ │:Swipe|   │ │      client: PoolClient      │
│          │ │null      │ │    ): Promise<boolean>       │
└──────────┘ └──────────┘ └──────────────────────────────┘
                                        │
                                        ▼
                            ┌──────────────────────────────┐
                            │  DS-SUPERLIKE-C9             │
                            │  <<class>>                   │
                            │  UserRepository              │
                            │──────────────────────────────│
                            │  - db: Pool                  │
                            │──────────────────────────────│
                            │  + findById(                 │
                            │      id: string,             │
                            │      client?: PoolClient     │
                            │    ): Promise<User|null>     │
                            └──────────────────────────────┘

TYPE DEFINITIONS (DS-SUPERLIKE-2.T1):
  SwipeAction = 'like' | 'nope' | 'superlike'
  SwipeResult = { swipeId: string, matched: boolean,
                  matchId?: string, quotaRemaining: number }
  QuotaStatus = { used: number, remaining: number, resetsAt: string }
  Match       = { id: string, user1_id: string, user2_id: string,
                  created_at: Date }
```

---

## 3. List of Classes

| Label              | Name                 | Purpose                                                                                     |
|--------------------|----------------------|---------------------------------------------------------------------------------------------|
| DS-SUPERLIKE-C1    | router.js            | Express router — mounts middleware and maps HTTP routes to controller methods               |
| DS-SUPERLIKE-C2    | AuthMiddleware       | Validates JWT Bearer token; populates `req.userId`; rejects with 401 on failure             |
| DS-SUPERLIKE-C3    | RateLimitMiddleware  | Per-IP burst rate limiter using `express-rate-limit`; prevents API abuse independent of quota|
| DS-SUPERLIKE-C4    | SwipeController      | HTTP adapter — parses/validates request, calls SwipeService, formats HTTP response          |
| DS-SUPERLIKE-C5    | SwipeService         | Orchestrates the full swipe workflow: quota check → record swipe → match detection, all within a single DB transaction |
| DS-SUPERLIKE-C6    | QuotaService         | Counts today's super likes for a user (UTC midnight boundary); enforces the 5/day limit     |
| DS-SUPERLIKE-C7    | SwipeRepository      | Data-access layer for the `swipes` table; inserts and queries swipe records                 |
| DS-SUPERLIKE-C8    | MatchService         | Checks whether a mutual like/superlike exists and inserts a `matches` row if so             |
| DS-SUPERLIKE-C9    | UserRepository       | Data-access layer for the `users` table; used to validate that `targetUserId` exists        |

---

## 4. State Diagrams

### 4.1 Swipe Record Lifecycle

```
DS-SUPERLIKE-S1.1        DS-SUPERLIKE-S1.2         DS-SUPERLIKE-S1.3
                                                
   [REQUEST_RECEIVED] ──► [QUOTA_CHECK] ─── QUOTA_EXCEEDED ──► [429_RETURNED]
                                │
                                │ QUOTA_OK
                                ▼
                         [DUPLICATE_CHECK] ─── DUPLICATE ──► [409_RETURNED]
                                │                              DS-SUPERLIKE-S1.4
                                │ NOT_DUPLICATE
                                ▼
                           [RECORDING] ──── DB_ERROR ──► [500_RETURNED]
                                │                         DS-SUPERLIKE-S1.5
                                │ WRITE_OK
                                ▼
                         [MATCH_CHECKED]
                           /         \
                    NO_MATCH         MATCH_CREATED
                       │                  │
                       ▼                  ▼
                  [200_RETURNED]     [200_RETURNED]
                  matched:false      matched:true
               DS-SUPERLIKE-S1.6   DS-SUPERLIKE-S1.7
```

### 4.2 Quota State Machine

```
                    DS-SUPERLIKE-S2.1
   ┌─────────────────────────────────────────────────────────┐
   │                    QUOTA_AVAILABLE                       │
   │             (remaining: 1..5, day boundary not yet hit) │
   └─────────────────────────────────────────────────────────┘
                           │
                           │ user performs superlike
                           │ (remaining decremented atomically)
                           ▼
   ┌─────────────────────────────────────────────────────────┐
   │  DS-SUPERLIKE-S2.2    QUOTA_CONSUMED                    │
   │             (remaining: 0..4, last superlike recorded)  │
   └─────────────────────────────────────────────────────────┘
                           │
                           │ remaining reaches 0
                           ▼
   ┌─────────────────────────────────────────────────────────┐
   │  DS-SUPERLIKE-S2.3    QUOTA_EXHAUSTED                   │
   │             (remaining: 0, all 5 used today UTC)        │
   └─────────────────────────────────────────────────────────┘
                           │
                           │ UTC midnight passes
                           │ (no background job needed —
                           │  quota is computed from
                           │  COUNT of today's swipe rows)
                           ▼
   ┌─────────────────────────────────────────────────────────┐
   │  DS-SUPERLIKE-S2.4    QUOTA_RESET                       │
   │             (remaining: 5, new calendar day UTC)        │
   └─────────────────────────────────────────────────────────┘
                           │
                           │ auto-transition back on first
                           │ superlike of the new day
                           ▼
                    [QUOTA_AVAILABLE]  (loop)
```

### 4.3 Match State Machine

```
   DS-SUPERLIKE-S3.1                    DS-SUPERLIKE-S3.2
   ┌───────────────┐   A superlikes B    ┌───────────────────────┐
   │               │ ──────────────────► │  REVERSE_CHECK        │
   │   NO_MATCH    │                     │  (query swipes table  │
   │               │                     │   for B→A like or     │
   └───────────────┘                     │   superlike)          │
          ▲                              └───────────────────────┘
          │                                    │            │
          │ no reverse                         │            │ reverse
          │ swipe found                        │            │ exists
          └────────────────────────────────────┘            │
                                                             ▼
                                                  DS-SUPERLIKE-S3.3
                                               ┌───────────────────────┐
                                               │   MATCH_CREATED       │
                                               │   (row inserted into  │
                                               │    matches table)     │
                                               └───────────────────────┘
```

---

## 5. Flow Charts

### FC-1: Happy Path — Super Like Succeeds with No Match

```
DS-SUPERLIKE-FC1

  [Client] POST /api/swipes { targetUserId, action: "superlike" }
       │
       ▼
  [DS-SUPERLIKE-FC1.1] AuthMiddleware
       │ JWT valid?
       ├── NO  ──► 401 Unauthorized
       └── YES ──► extract req.userId
       │
       ▼
  [DS-SUPERLIKE-FC1.2] RateLimitMiddleware
       │ IP within burst window?
       ├── NO  ──► 429 Too Many Requests (burst)
       └── YES ──►
       │
       ▼
  [DS-SUPERLIKE-FC1.3] SwipeController.postSwipe()
       │ Validate body schema
       │ targetUserId present and UUID? action === "superlike"?
       ├── NO  ──► 400 Bad Request
       └── YES ──►
       │
       ▼
  [DS-SUPERLIKE-FC1.4] SwipeService.recordSwipe()
       │ Begin serializable transaction
       │
       ▼
  [DS-SUPERLIKE-FC1.5] UserRepository.findById(targetUserId)
       │ Target user exists?
       ├── NO  ──► rollback → 404 Not Found
       └── YES ──►
       │
       ▼
  [DS-SUPERLIKE-FC1.6] Guard: swiperId === targetUserId?
       ├── YES ──► rollback → 403 Forbidden (self-superlike)
       └── NO  ──►
       │
       ▼
  [DS-SUPERLIKE-FC1.7] SwipeRepository.findSwipe(swiperId, targetId)
       │ Swipe already recorded?
       ├── YES ──► rollback → 409 Conflict
       └── NO  ──►
       │
       ▼
  [DS-SUPERLIKE-FC1.8] QuotaService.checkQuota(userId, client)
       │ COUNT superlikes today (UTC) >= 5?
       ├── YES ──► rollback → 429 Too Many Requests (quota)
       └── NO  ──► quotaRemaining = 5 - count - 1
       │
       ▼
  [DS-SUPERLIKE-FC1.9] SwipeRepository.createSwipe(data, client)
       │ INSERT INTO swipes (swiper_id, target_id, action='superlike')
       │
       ▼
  [DS-SUPERLIKE-FC1.10] MatchService.checkAndCreateMatch()
       │ B→A like or superlike exists?
       ├── YES ──► INSERT INTO matches → matched: true
       └── NO  ──► matched: false
       │
       ▼
  [DS-SUPERLIKE-FC1.11] COMMIT transaction
       │
       ▼
  [DS-SUPERLIKE-FC1.12] 200 OK
  {
    "swipeId": "uuid",
    "matched": false,
    "quotaRemaining": 4
  }
```

### FC-2: Quota Exhausted

```
DS-SUPERLIKE-FC2

  [Client] POST /api/swipes { targetUserId, action: "superlike" }
       │
       ▼
  [Auth + RateLimit pass — same as FC-1.1, FC-1.2]
       │
       ▼
  [DS-SUPERLIKE-FC2.1] SwipeService begins serializable transaction
       │
       ▼
  [DS-SUPERLIKE-FC2.2] QuotaService.checkQuota(userId, client)
       │
       │  SELECT COUNT(*) FROM swipes
       │  WHERE swiper_id = $1
       │    AND action = 'superlike'
       │    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
       │
       │  count = 5?
       └── YES ──►
       │
       ▼
  [DS-SUPERLIKE-FC2.3] ROLLBACK transaction
       │
       ▼
  [DS-SUPERLIKE-FC2.4] 429 Too Many Requests
  {
    "error": "QUOTA_EXCEEDED",
    "message": "Super like quota exhausted. Resets at midnight UTC.",
    "quotaRemaining": 0,
    "resetsAt": "2025-07-10T00:00:00Z"
  }
```

### FC-3: Match Detection

```
DS-SUPERLIKE-FC3

  [DS-SUPERLIKE-FC3.1]
  Swipe recorded: user A superliked user B
       │
       ▼
  [DS-SUPERLIKE-FC3.2] MatchService.hasLikedOrSuperliked(B, A, client)
       │
       │  SELECT id FROM swipes
       │  WHERE swiper_id = B
       │    AND target_id = A
       │    AND action IN ('like', 'superlike')
       │  LIMIT 1
       │
       │  Row found?
       ├── NO  ──► [DS-SUPERLIKE-FC3.3] return null (no match)
       └── YES ──►
       │
       ▼
  [DS-SUPERLIKE-FC3.4] Check if match already exists
       │
       │  SELECT id FROM matches
       │  WHERE (user1_id = A AND user2_id = B)
       │     OR (user1_id = B AND user2_id = A)
       │  LIMIT 1
       │
       │  Already matched?
       ├── YES ──► [DS-SUPERLIKE-FC3.5] return existing match (idempotent)
       └── NO  ──►
       │
       ▼
  [DS-SUPERLIKE-FC3.6]
       │  INSERT INTO matches (user1_id, user2_id)
       │  VALUES (min(A,B), max(A,B))  -- canonical ordering
       │  RETURNING *
       │
       ▼
  [DS-SUPERLIKE-FC3.7] return Match object
  → SwipeService includes matched: true, matchId in response
```

### FC-4: Duplicate Super Like Attempt

```
DS-SUPERLIKE-FC4

  [Client] POST /api/swipes { targetUserId: B, action: "superlike" }
           (user A has already superliked B before)
       │
       ▼
  [Auth + RateLimit pass]
       │
       ▼
  [DS-SUPERLIKE-FC4.1] SwipeService begins serializable transaction
       │
       ▼
  [DS-SUPERLIKE-FC4.2] SwipeRepository.findSwipe(A, B, client)
       │
       │  SELECT id FROM swipes
       │  WHERE swiper_id = A AND target_id = B
       │  LIMIT 1
       │
       │  Row found?
       └── YES ──►
       │
       ▼
  [DS-SUPERLIKE-FC4.3] ROLLBACK transaction
       │
       ▼
  [DS-SUPERLIKE-FC4.4] 409 Conflict
  {
    "error": "DUPLICATE_SWIPE",
    "message": "You have already swiped on this profile."
  }
```

---

## 6. Possible Threats and Failures

| Label              | Failure Mode                                  | Effect                                                     | Likelihood | Impact  | Recovery                                                                                 |
|--------------------|-----------------------------------------------|------------------------------------------------------------|------------|---------|------------------------------------------------------------------------------------------|
| DS-SUPERLIKE-F1    | PostgreSQL connection failure                 | All swipe requests fail with 500                           | Low        | High    | Implement connection pool retry with exponential backoff; surface 503 to client          |
| DS-SUPERLIKE-F2    | Quota race condition (concurrent superlikes)  | Two simultaneous requests both read count=4, both proceed, resulting in 6 uses | Medium | High | Use serializable transaction (see §12.6); DB UNIQUE + COUNT inside same txn prevents double-spend |
| DS-SUPERLIKE-F3    | JWT expiry mid-request                        | AuthMiddleware rejects with 401                            | Medium     | Low     | Client must re-authenticate; expected behavior; ensure short-lived tokens (15min–1hr)    |
| DS-SUPERLIKE-F4    | Invalid / non-existent targetUserId           | UserRepository returns null                                | Medium     | Low     | Return 404 Not Found; validate UUID format in controller before hitting DB               |
| DS-SUPERLIKE-F5    | Clock skew / timezone issues at quota reset   | Quota may not reset correctly at UTC midnight              | Low        | Medium  | All quota queries use `date_trunc('day', now() AT TIME ZONE 'UTC')` in PostgreSQL; DB server clock is authoritative |
| DS-SUPERLIKE-F6    | Self-super-like attempt                       | User tries to superlike their own profile                  | Low        | Medium  | Explicit guard: if `swiperId === targetId` return 403 Forbidden before any DB query     |
| DS-SUPERLIKE-F7    | Match insert race (two users superlike simultaneously) | Both insert matches row simultaneously              | Low        | Low     | `UNIQUE(user1_id, user2_id)` with canonical ordering + `ON CONFLICT DO NOTHING` makes insert idempotent |
| DS-SUPERLIKE-F8    | DB transaction deadlock                       | Two concurrent txns deadlock; one is rolled back by Postgres | Low      | Medium  | Catch `error.code === '40P01'` (deadlock) and retry once with jitter                    |
| DS-SUPERLIKE-F9    | Serialization failure (serializable txn)      | Postgres aborts txn with `40001` on read-write conflict    | Medium     | Low     | Catch `error.code === '40001'` and retry up to 3 times                                  |
| DS-SUPERLIKE-F10   | Network timeout between app server and DB     | Request hangs; client eventually times out                 | Low        | Medium  | Set `statement_timeout` and `query_timeout` on pg Pool; return 504 Gateway Timeout       |

---

## 7. Technologies

| Technology           | Version    | URL                                          | Why Chosen                                                                          | Alternatives Considered                       |
|----------------------|------------|----------------------------------------------|-------------------------------------------------------------------------------------|-----------------------------------------------|
| Node.js              | 20 LTS     | https://nodejs.org                           | Non-blocking I/O suits high-concurrency swipe workload; team familiarity            | Python/FastAPI, Go/Gin                        |
| Express              | 4.x        | https://expressjs.com                        | Minimal, well-understood HTTP framework; large middleware ecosystem                 | Fastify (faster), Koa (lighter)               |
| PostgreSQL           | 15+        | https://postgresql.org                       | ACID transactions, serializable isolation for quota safety, mature JSONB if needed  | MySQL, MongoDB (lacks serializable txn ease)  |
| node-postgres (pg)   | 8.x        | https://node-postgres.com                    | Native PostgreSQL driver; supports connection pooling and `PoolClient` for txns      | Knex.js, Prisma (adds abstraction overhead)   |
| jsonwebtoken         | 9.x        | https://github.com/auth0/node-jsonwebtoken   | Standard JWT sign/verify; supports RS256 for public-key verification                | passport-jwt (more setup), jose               |
| bcrypt               | 5.x        | https://github.com/kelektiv/node.bcrypt.js   | Password hashing for user auth (not directly in super like path, but in auth layer) | argon2 (better but less common in Node ecosystem) |
| express-rate-limit   | 7.x        | https://github.com/express-rate-limit        | Per-IP request burst limiter; zero-config, well-maintained                          | redis-rate-limit (needed for multi-instance)  |
| uuid (v4)            | 9.x        | https://github.com/uuidjs/uuid               | Generates UUIDs for swipe/match IDs                                                 | nanoid, DB-generated UUIDs (via gen_random_uuid()) |

### Quota Tracking Approach: DB COUNT vs Redis

| Approach                  | Pros                                                        | Cons                                                           | Recommendation         |
|---------------------------|-------------------------------------------------------------|----------------------------------------------------------------|------------------------|
| **DB COUNT query** (chosen) | No extra infrastructure; strongly consistent within serializable txn; quota resets naturally at UTC midnight via date_trunc | Adds one SELECT per superlike request inside transaction      | ✅ Use this for v1     |
| Redis atomic INCR + EXPIRE | Very fast (~0.1ms); horizontal scaling friendly             | Requires Redis; TTL-based reset is approximate (not true UTC midnight); adds infrastructure complexity; requires synchronization with DB | Use in v2 if scale demands it |

The chosen approach executes:
```sql
SELECT COUNT(*) FROM swipes
WHERE swiper_id = $1
  AND action = 'superlike'
  AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
```
inside the same serializable transaction as the swipe INSERT, making the count-and-write atomic.

---

## 8. APIs

### 8.1 POST /api/swipes

| Field          | Value                                                  |
|----------------|--------------------------------------------------------|
| Method         | POST                                                   |
| Path           | /api/swipes                                            |
| Auth Required  | Yes — `Authorization: Bearer <jwt>`                    |
| Content-Type   | application/json                                       |

**Request Body Schema:**
```json
{
  "targetUserId": "string (UUID, required)",
  "action": "string (enum: 'like' | 'nope' | 'superlike', required)"
}
```

**Validation Rules (DS-SUPERLIKE-A1.V):**
- `targetUserId`: required, must be a valid UUID v4, must not equal `req.userId`
- `action`: required, must be one of `['like', 'nope', 'superlike']`

**Success Response — 200 OK:**
```json
{
  "swipeId": "3f7a9c1b-...",
  "matched": false,
  "matchId": null,
  "quotaRemaining": 4,
  "action": "superlike"
}
```
*(When `matched: true`, `matchId` will be a UUID string.)*
*(`quotaRemaining` is only meaningful when `action === "superlike"`; for other actions it will be `null`.)*

**Error Responses:**

| HTTP Status | Error Code         | Condition                                                          |
|-------------|--------------------|--------------------------------------------------------------------|
| 400         | INVALID_REQUEST    | Missing/invalid `targetUserId` or `action` not in enum            |
| 401         | UNAUTHORIZED       | Missing, expired, or malformed JWT                                 |
| 403         | FORBIDDEN          | `targetUserId` equals `swiperId` (self-superlike)                 |
| 404         | USER_NOT_FOUND     | `targetUserId` does not exist in the `users` table                |
| 409         | DUPLICATE_SWIPE    | Caller has already swiped on this `targetUserId`                  |
| 429         | QUOTA_EXCEEDED     | 5 super likes already used today (UTC); includes `resetsAt`       |
| 429         | RATE_LIMIT         | Per-IP burst limit exceeded (separate from quota)                 |
| 500         | INTERNAL_ERROR     | Unexpected DB error or unhandled exception                        |

**Error Response Body Schema:**
```json
{
  "error": "QUOTA_EXCEEDED",
  "message": "Super like quota exhausted for today.",
  "quotaRemaining": 0,
  "resetsAt": "2025-07-10T00:00:00.000Z"
}
```

---

### 8.2 GET /api/swipes/quota

| Field         | Value                               |
|---------------|-------------------------------------|
| Method        | GET                                 |
| Path          | /api/swipes/quota                   |
| Auth Required | Yes — `Authorization: Bearer <jwt>` |

**Purpose:** Returns the authenticated user's current super like quota status without performing a swipe.

**Request Body:** None

**Success Response — 200 OK:**
```json
{
  "dailyLimit": 5,
  "used": 3,
  "remaining": 2,
  "resetsAt": "2025-07-10T00:00:00.000Z"
}
```

**Error Responses:**

| HTTP Status | Error Code    | Condition                         |
|-------------|---------------|-----------------------------------|
| 401         | UNAUTHORIZED  | Missing, expired, or malformed JWT|
| 500         | INTERNAL_ERROR| DB error                          |

---

## 9. Public Interfaces

Method signatures called across module boundaries.

| Label              | Caller            | Method Signature                                                                                         | Callee            | Notes                                                                                    |
|--------------------|-------------------|----------------------------------------------------------------------------------------------------------|-------------------|------------------------------------------------------------------------------------------|
| DS-SUPERLIKE-I1    | SwipeController   | `swipeService.recordSwipe(swiperId, targetId, action)`                                                   | SwipeService      | Main entry point; returns `SwipeResult`                                                  |
| DS-SUPERLIKE-I2    | SwipeController   | `swipeService.getQuotaStatus(userId)`                                                                    | SwipeService      | Used by GET /api/swipes/quota                                                            |
| DS-SUPERLIKE-I3    | SwipeService      | `userRepository.findById(targetId, client)`                                                              | UserRepository    | Validates target user exists; called inside transaction                                  |
| DS-SUPERLIKE-I4    | SwipeService      | `swipeRepository.findSwipe(swiperId, targetId, client)`                                                  | SwipeRepository   | Duplicate check before insert; called inside transaction                                 |
| DS-SUPERLIKE-I5    | SwipeService      | `quotaService.checkQuota(swiperId, client): Promise<QuotaStatus>`                                        | QuotaService      | Returns `{ used, remaining, resetsAt }`; throws `QuotaExceededError` if remaining === 0 |
| DS-SUPERLIKE-I6    | SwipeService      | `swipeRepository.createSwipe({ swiperId, targetId, action }, client): Promise<Swipe>`                   | SwipeRepository   | Inserts swipe row inside open transaction                                                |
| DS-SUPERLIKE-I7    | SwipeService      | `matchService.checkAndCreateMatch(swiperId, targetId, client): Promise<Match|null>`                      | MatchService      | Called only when `action === 'superlike'` or `action === 'like'`; skipped for 'nope'     |
| DS-SUPERLIKE-I8    | MatchService      | `db.query(sql, [B, A])` (internal)                                                                       | PostgreSQL        | Checks for reverse swipe using the shared `PoolClient` (same transaction)                |

---

## 10. Data Schemas

### 10.1 PostgreSQL DDL

```sql
-- DS-SUPERLIKE-D1: users table
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DS-SUPERLIKE-D2: swipe action enum
CREATE TYPE swipe_action AS ENUM ('like', 'nope', 'superlike');

-- DS-SUPERLIKE-D3: swipes table
CREATE TABLE swipes (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  swiper_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      swipe_action NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_swipe_pair UNIQUE (swiper_id, target_id),
  CONSTRAINT chk_no_self_swipe CHECK (swiper_id <> target_id)
);

-- DS-SUPERLIKE-D4: Index for quota COUNT query performance
CREATE INDEX idx_swipes_quota
  ON swipes (swiper_id, action, created_at)
  WHERE action = 'superlike';

-- DS-SUPERLIKE-D5: Index for reverse-swipe lookup (match detection)
CREATE INDEX idx_swipes_target_swiper
  ON swipes (target_id, swiper_id, action);

-- DS-SUPERLIKE-D6: matches table
-- Canonical ordering: user1_id < user2_id (lexicographic UUID comparison)
-- ensures the UNIQUE constraint catches both orderings.
CREATE TABLE matches (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_match_pair UNIQUE (user1_id, user2_id),
  CONSTRAINT chk_match_ordering CHECK (user1_id < user2_id),
  CONSTRAINT chk_no_self_match CHECK (user1_id <> user2_id)
);
```

### 10.2 Key Queries

**DS-SUPERLIKE-D7: Quota Count Query (runs inside serializable transaction)**
```sql
SELECT COUNT(*)::int AS used
FROM swipes
WHERE swiper_id = $1
  AND action = 'superlike'
  AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC');
```

**DS-SUPERLIKE-D8: Duplicate Swipe Check**
```sql
SELECT id FROM swipes
WHERE swiper_id = $1
  AND target_id = $2
LIMIT 1;
```

**DS-SUPERLIKE-D9: Reverse Swipe Check (Match Detection)**
```sql
SELECT id FROM swipes
WHERE swiper_id = $1   -- target user (B)
  AND target_id  = $2  -- swiper (A)
  AND action IN ('like', 'superlike')
LIMIT 1;
```

**DS-SUPERLIKE-D10: Match Insert (idempotent)**
```sql
INSERT INTO matches (user1_id, user2_id)
VALUES (
  LEAST($1::uuid, $2::uuid),
  GREATEST($1::uuid, $2::uuid)
)
ON CONFLICT (user1_id, user2_id) DO NOTHING
RETURNING *;
```

---

## 11. Risks to Completion

| Label              | Component      | Risk Category          | Difficulty | Notes                                                                                                                                                               |
|--------------------|----------------|------------------------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| DS-SUPERLIKE-R1    | QuotaService   | Concurrency / Race     | High       | Two simultaneous requests both read `used=4`, both proceed to insert, resulting in 6 super likes. **Mitigation:** Serializable transactions (see §12.6). Requires retry logic for `40001` errors. |
| DS-SUPERLIKE-R2    | QuotaService   | Clock / Timezone       | Medium     | If the app server has a different timezone than PostgreSQL, `date_trunc` comparisons may not reset at true UTC midnight. **Mitigation:** Always use `NOW() AT TIME ZONE 'UTC'` in the SQL query; never rely on app-server `Date`. |
| DS-SUPERLIKE-R3    | MatchService   | Logic Correctness      | Medium     | Super like must trigger a match when the reverse action is 'like', not just 'superlike'. Developers may accidentally only check `action = 'superlike'` in the reverse query. **Mitigation:** Query uses `action IN ('like', 'superlike')`. Code review must verify this. |
| DS-SUPERLIKE-R4    | MatchService   | Duplicate Match        | Low        | If two users superlike each other simultaneously, both transactions may attempt to insert a match. **Mitigation:** `ON CONFLICT DO NOTHING` with canonical `LEAST/GREATEST` ordering in the INSERT. |
| DS-SUPERLIKE-R5    | SwipeService   | Transaction Isolation  | Medium     | Using `SERIALIZABLE` isolation may cause unexpected rollbacks (`40001`) under moderate load. **Mitigation:** Retry logic (up to 3 attempts with jitter). Monitor rollback rate in production. |
| DS-SUPERLIKE-R6    | SwipeController| Input Validation       | Low        | Malformed UUIDs or unexpected `action` values may reach the DB layer. **Mitigation:** Validate UUID format and action enum in controller before opening any DB transaction. |
| DS-SUPERLIKE-R7    | Infrastructure | Scaling                | Low        | `express-rate-limit` is in-memory per process; ineffective when running multiple app instances. **Mitigation:** For multi-instance deployments, configure a shared Redis store for `express-rate-limit`. |

---

## 12. Security and Privacy

### 12.1 PII Stored

| Data Element          | Table      | Retention Policy                 | Protection                                              | Disposal                                      |
|-----------------------|------------|----------------------------------|---------------------------------------------------------|-----------------------------------------------|
| Email address         | `users`    | Until account deletion           | Stored in plaintext; access restricted by DB roles      | Hard DELETE on account deletion               |
| Password              | `users`    | Until account deletion           | Stored as bcrypt hash (cost factor ≥ 12); never stored in plaintext | Hash deleted with account row         |
| Swipe history         | `swipes`   | Until account deletion           | Linked to `user_id`; no direct PII; CASCADE DELETE      | Hard DELETE via FK cascade on user deletion   |
| Match records         | `matches`  | Until either user deletes account| Linked to `user1_id`/`user2_id`; CASCADE DELETE         | Hard DELETE via FK cascade on user deletion   |
| JWT payload           | In-transit | Token lifetime (15min–1hr)       | Signed with RS256 or HS256; never stored on server      | Token expiry handles disposal                 |

**DS-SUPERLIKE-12.1.N:** Super like metadata (who superliked whom, when) is sensitive behavioral data. Ensure DB access is restricted via least-privilege Postgres roles. The app user should have only `SELECT`, `INSERT` on `swipes` and `matches`, not `DELETE` or `TRUNCATE`.

---

### 12.2 Authentication

- **DS-SUPERLIKE-12.2.1:** All `/api/swipes` endpoints require a valid JWT Bearer token.
- **DS-SUPERLIKE-12.2.2:** AuthMiddleware calls `jwt.verify(token, secret)` synchronously. If verification throws (expired, malformed, wrong signature), respond with `401 Unauthorized`.
- **DS-SUPERLIKE-12.2.3:** The `sub` claim (or a custom `userId` claim) from the verified payload is attached to `req.userId`. Never trust a `userId` from the request body.
- **DS-SUPERLIKE-12.2.4:** Recommended token lifetime: 15 minutes (access token) with a refresh token flow. The super like endpoint does not refresh tokens — that is the auth service's concern.
- **DS-SUPERLIKE-12.2.5:** Use `RS256` (asymmetric) in production so the swipe service only needs the public key and cannot issue new tokens.

---

### 12.3 Authorization

- **DS-SUPERLIKE-12.3.1:** `swiperId` is always taken from `req.userId` (the JWT payload), never from the request body. Users cannot swipe as another user.
- **DS-SUPERLIKE-12.3.2:** A user cannot super-like themselves. Guard: `if (swiperId === targetId) return res.status(403).json({ error: 'FORBIDDEN' })`. Additionally enforced by DB CHECK constraint `chk_no_self_swipe`.
- **DS-SUPERLIKE-12.3.3:** A user can only read their own quota (`GET /api/swipes/quota` uses `req.userId`). No admin quota override endpoint in v1.

---

### 12.4 Rate Limiting

Two independent layers of rate limiting:

| Layer                        | Mechanism                    | Limit               | Response | Purpose                                      |
|------------------------------|------------------------------|---------------------|----------|----------------------------------------------|
| DS-SUPERLIKE-12.4.L1: IP burst | `express-rate-limit` (per IP) | 30 req / 60 seconds | 429      | Prevents API abuse and DDoS                  |
| DS-SUPERLIKE-12.4.L2: Daily quota | DB COUNT query (per user) | 5 superlikes / UTC day | 429   | Business rule enforcement                    |

The IP burst limiter runs before auth; it applies to all clients regardless of authentication status.

---

### 12.5 Injection and Input Validation

- **DS-SUPERLIKE-12.5.1:** All database queries use parameterized queries via `node-postgres` (`$1`, `$2` placeholders). String interpolation into SQL is strictly prohibited.
- **DS-SUPERLIKE-12.5.2:** `targetUserId` is validated as a UUID v4 string in the controller before any DB call (regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`).
- **DS-SUPERLIKE-12.5.3:** `action` is validated against an allowlist `['like', 'nope', 'superlike']`. Any other value returns 400.
- **DS-SUPERLIKE-12.5.4:** Request body size is limited by Express `json()` middleware (default 100kb; should be lowered to `1kb` for this endpoint).
- **DS-SUPERLIKE-12.5.5:** The `swipe_action` PostgreSQL ENUM provides a second layer of enforcement — the DB will reject any action value not in the enum even if validation is bypassed.

---

### 12.6 Concurrency and Race Conditions — CRITICAL

**The Problem (DS-SUPERLIKE-12.6.P):**

Consider user A making two simultaneous super like requests (e.g., double-tap or network retry):

```
Request 1 (Conn 1):  BEGIN → COUNT = 4 (quota OK) → [not yet inserted]
Request 2 (Conn 2):  BEGIN → COUNT = 4 (quota OK) → [not yet inserted]
Request 1 (Conn 1):  INSERT swipe → COMMIT  (total: 5 today ✓)
Request 2 (Conn 2):  INSERT swipe → COMMIT  (total: 6 today ✗ QUOTA BYPASSED)
```

**Evaluated Options:**

| Option                                     | How It Works                                                                                           | Pro                                         | Con                                                    |
|--------------------------------------------|--------------------------------------------------------------------------------------------------------|---------------------------------------------|--------------------------------------------------------|
| A. `READ COMMITTED` + application lock     | App acquires Redis/DB advisory lock per user before quota check                                         | Works without retry logic                   | Requires Redis or advisory lock infrastructure; complex |
| B. Serializable Transaction (**chosen**)   | `BEGIN ISOLATION LEVEL SERIALIZABLE`; Postgres detects read-write conflict and aborts one txn with `40001` | No extra infrastructure; purely PostgreSQL  | Requires retry logic on `40001`; slightly higher abort rate under load |
| C. `SELECT ... FOR UPDATE` on a quota row  | Requires a dedicated `user_quota` table with a lockable row                                            | Predictable locking                         | Extra table; DDL changes; serializes all superlikes per user |

**Recommendation: Option B — Serializable Transactions**

**Implementation (DS-SUPERLIKE-12.6.I):**

```javascript
async function recordSwipe(swiperId, targetId, action) {
  const client = await db.connect();
  let attempts = 0;
  const MAX_RETRIES = 3;

  while (attempts < MAX_RETRIES) {
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // 1. Validate target exists
      // 2. Guard: no self-swipe
      // 3. Check duplicate
      // 4. Check quota (COUNT query) ← read that creates the serial dependency
      // 5. INSERT swipe              ← write that completes the serial dependency
      // 6. Check and create match

      await client.query('COMMIT');
      return result;

    } catch (err) {
      await client.query('ROLLBACK');

      if (err.code === '40001' && attempts < MAX_RETRIES - 1) {
        // Serialization failure — retry with jitter
        attempts++;
        await sleep(Math.random() * 50 * attempts);
        continue;
      }
      throw err;
    } finally {
      if (attempts >= MAX_RETRIES - 1) client.release();
    }
  }
  client.release();
}
```

**Why Serializable Works Here:**  
In `SERIALIZABLE` isolation, PostgreSQL tracks which rows were read (the COUNT result) and which rows were written (the new swipe row). If two concurrent transactions both read the same quota count and then both try to insert a swipe row for the same user, PostgreSQL detects that the serial order is not achievable and aborts one transaction with error `40001`. The retried transaction will then see the updated COUNT and correctly enforce the quota.

**Additional Safety Net (DS-SUPERLIKE-12.6.S):**  
The `UNIQUE(swiper_id, target_id)` constraint ensures that even if the serializable isolation were somehow bypassed, no duplicate swipe record can be inserted for the same pair, providing defense in depth.

---

### 12.7 Quota Bypass Attempts

| Attack Vector                   | Description                                                             | Mitigation                                                                                                    |
|---------------------------------|-------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| DS-SUPERLIKE-12.7.A1: Clock manipulation | Client sends requests with manipulated `Date` headers or `iat` claims  | Quota window is computed entirely in PostgreSQL using `NOW()` — client time is irrelevant                      |
| DS-SUPERLIKE-12.7.A2: Forged JWT        | Attacker crafts a JWT with a different `userId` to use another user's quota | JWT is verified with server-held secret/public key; forgery without the key is computationally infeasible   |
| DS-SUPERLIKE-12.7.A3: JWT replay        | Valid token stolen and replayed after expiry                            | Short token lifetime (15min); implement token revocation list (deny-list in Redis) for high-security deployments |
| DS-SUPERLIKE-12.7.A4: Multiple accounts | User creates many accounts to bypass per-user quota                    | Out of scope for v1; address with phone verification or device fingerprinting in later versions                |
| DS-SUPERLIKE-12.7.A5: Rapid-fire retry  | Attacker retries on 40001 faster than legitimate users                  | Retry jitter in the application; IP burst rate limiting (§12.4.L1)                                           |
| DS-SUPERLIKE-12.7.A6: Timezone boundary | Sending superlikes just before/after UTC midnight to "reset" quota early| `date_trunc('day', NOW() AT TIME ZONE 'UTC')` in SQL; clock is the DB server's authoritative UTC clock       |

---

*End of DS-SUPERLIKE Backend Developer Specification v1.0.0*
