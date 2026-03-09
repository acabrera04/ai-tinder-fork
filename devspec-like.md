# Backend Developer Specification — Like Feature
## AI Tinder App

**Version:** 1.0  
**Feature:** Like (Swipe Right)  
**Scope:** Backend only — REST API, service layer, database  
**Last Updated:** 2025

---

## Table of Contents

1. Architecture Diagram
2. Class Diagram
3. List of Classes
4. State Diagrams
5. Flow Charts
6. Possible Threats and Failures
7. Technologies
8. APIs
9. Public Interfaces
10. Data Schemas
11. Risks to Completion
12. Security and Privacy

---

## 1. Architecture Diagram

Full request path from authenticated client through middleware, service layer, and database. Concurrent-user safety is enforced via a DB-level `UNIQUE` constraint and serializable transaction isolation on match detection.

```
DS-LIKE-1.1                  DS-LIKE-1.2
┌───────────────────┐         ┌──────────────────────────┐
│      CLIENT       │──POST──▶│  Express HTTP Server      │
│  (Browser / App)  │         │  POST /api/swipes         │
│                   │◀──JSON──│  DS-LIKE-1.3              │
└───────────────────┘         └──────────┬───────────────┘
                                         │
                               DS-LIKE-1.4
                          ┌──────────────▼───────────────┐
                          │     AuthMiddleware            │
                          │  • Extracts Bearer token      │
                          │  • Verifies JWT signature     │
                          │  • Attaches req.user.id       │
                          │  DS-LIKE-1.5                  │
                          └──────────────┬────────────────┘
                                         │ 401 if invalid
                          ┌──────────────▼────────────────┐
                          │    RateLimitMiddleware        │
                          │  • express-rate-limit         │
                          │  • 60 swipes / 60 s / user    │
                          │  DS-LIKE-1.6                  │
                          └──────────────┬────────────────┘
                                         │ 429 if exceeded
                          ┌──────────────▼────────────────┐
                          │     SwipeController           │
                          │  • Validates request body     │
                          │  • Calls SwipeService         │
                          │  DS-LIKE-1.7                  │
                          └──────────────┬────────────────┘
                                         │
                          ┌──────────────▼────────────────┐
                          │      SwipeService             │
                          │  • Business logic             │
                          │  • Calls SwipeRepository      │
                          │  • Calls MatchService         │
                          │  DS-LIKE-1.8                  │
                          └────┬─────────────────┬────────┘
                               │                 │
              DS-LIKE-1.9      │                 │  DS-LIKE-1.10
      ┌────────────────────────▼──┐   ┌──────────▼────────────────┐
      │     SwipeRepository       │   │      MatchService         │
      │  • INSERT INTO swipes     │   │  • Checks reverse swipe   │
      │  • ON CONFLICT DO NOTHING │   │  • INSERT INTO matches    │
      │  DS-LIKE-1.11             │   │  DS-LIKE-1.12             │
      └────────────────────────┬──┘   └──────────┬────────────────┘
                               │                 │
              DS-LIKE-1.13     │                 │  DS-LIKE-1.13
                    ┌──────────▼─────────────────▼──────────┐
                    │             PostgreSQL                  │
                    │  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
                    │  │  users  │ │ swipes  │ │ matches │  │
                    │  │DS-LIKE- │ │DS-LIKE- │ │DS-LIKE- │  │
                    │  │  1.14   │ │  1.15   │ │  1.16   │  │
                    │  └─────────┘ └─────────┘ └─────────┘  │
                    │                                         │
                    │  Concurrency Controls:                  │
                    │  • UNIQUE(swiper_id, target_id)         │
                    │  • UNIQUE(user1_id, user2_id)           │
                    │  • SERIALIZABLE isolation on match tx   │
                    └─────────────────────────────────────────┘

Legend:
  ──▶  HTTP request / method call
  ◀──  HTTP response / return value
```

---

## 2. Class Diagram

All backend modules with fields, methods, and dependencies shown. Labels follow `DS-LIKE-C{n}`.

```
DS-LIKE-C1                              DS-LIKE-C2
┌──────────────────────────┐            ┌──────────────────────────────┐
│        Router            │            │      AuthMiddleware           │
│  (routes/swipes.js)      │            │  (middleware/auth.js)        │
│──────────────────────────│            │──────────────────────────────│
│  - router: Express.Router│            │  - jwtSecret: string         │
│──────────────────────────│            │──────────────────────────────│
│  + register(app): void   │──uses──▶   │  + handle(req,res,next):void │
│                          │            │  - extractToken(req): string │
└──────────────────────────┘            │  - verify(token): JwtPayload │
           │                            └──────────────────────────────┘
           │ registers
           ▼
DS-LIKE-C3
┌──────────────────────────────────────┐
│         SwipeController              │
│  (controllers/SwipeController.js)    │
│──────────────────────────────────────│
│  - swipeService: SwipeService        │
│──────────────────────────────────────│
│  + postSwipe(req, res): Promise<void>│
│  - validateBody(body): ValidationErr │
└──────────────────────────────────────┘
           │ calls
           ▼
DS-LIKE-C4
┌──────────────────────────────────────────┐
│            SwipeService                   │
│  (services/SwipeService.js)               │
│──────────────────────────────────────────│
│  - swipeRepo: SwipeRepository            │
│  - matchService: MatchService            │
│  - userRepo: UserRepository              │
│──────────────────────────────────────────│
│  + recordSwipe(swiperId, targetId,        │
│      action): Promise<SwipeResult>       │
│  - assertTargetExists(id): Promise<void> │
│  - assertNotSelf(a, b): void             │
└──────────────────────────────────────────┘
      │                     │
      │ calls               │ calls
      ▼                     ▼
DS-LIKE-C5              DS-LIKE-C6
┌─────────────────────┐  ┌─────────────────────────────────┐
│  SwipeRepository    │  │        MatchService              │
│(repos/SwipeRepo.js) │  │  (services/MatchService.js)      │
│─────────────────────│  │─────────────────────────────────│
│  - pool: pg.Pool    │  │  - matchRepo: MatchRepository   │
│─────────────────────│  │  - swipeRepo: SwipeRepository   │
│  + insert(swiperId, │  │─────────────────────────────────│
│    targetId, action)│  │  + checkAndCreate(userA, userB) │
│    : Promise<Swipe> │  │    : Promise<Match|null>        │
│  + findReverse(     │  │  - isMatchAlreadyCreated(a,b)   │
│    a, b)            │  │    : Promise<boolean>           │
│    : Promise<Swipe> │  └─────────────────────────────────┘
└─────────────────────┘               │ calls
           │                          ▼
           │                DS-LIKE-C7
           │         ┌──────────────────────────────┐
           │         │      MatchRepository          │
           │         │  (repos/MatchRepo.js)         │
           │         │──────────────────────────────│
           │         │  - pool: pg.Pool              │
           │         │──────────────────────────────│
           │         │  + insert(userA, userB)       │
           │         │    : Promise<Match>           │
           │         │  + findByUsers(a, b)          │
           │         │    : Promise<Match|null>      │
           │         └──────────────────────────────┘
           │
DS-LIKE-C8 │
┌──────────▼───────────────────────────┐
│         UserRepository               │
│  (repos/UserRepo.js)                 │
│──────────────────────────────────────│
│  - pool: pg.Pool                     │
│──────────────────────────────────────│
│  + findById(id): Promise<User|null>  │
└──────────────────────────────────────┘

DS-LIKE-C9
┌──────────────────────────────────────┐
│     RateLimitMiddleware              │
│  (middleware/rateLimit.js)           │
│──────────────────────────────────────│
│  - windowMs: number                  │
│  - max: number                       │
│  - keyGenerator: (req) => string     │
│──────────────────────────────────────│
│  + handle(req,res,next): void        │
└──────────────────────────────────────┘
```

---

## 3. List of Classes

| Label       | Name                  | Purpose                                                                                   |
|-------------|-----------------------|-------------------------------------------------------------------------------------------|
| DS-LIKE-C1  | Router                | Registers `POST /api/swipes` with auth + rate-limit middleware and SwipeController        |
| DS-LIKE-C2  | AuthMiddleware        | Extracts and verifies JWT bearer token; attaches `req.user.id` to the request             |
| DS-LIKE-C3  | SwipeController       | HTTP layer: parses/validates request body, calls SwipeService, returns JSON response      |
| DS-LIKE-C4  | SwipeService          | Core business logic: validates inputs, persists swipe, triggers match detection           |
| DS-LIKE-C5  | SwipeRepository       | Data access for `swipes` table; handles INSERT and reverse-swipe lookup                   |
| DS-LIKE-C6  | MatchService          | Orchestrates match detection; runs within a DB transaction to prevent race conditions     |
| DS-LIKE-C7  | MatchRepository       | Data access for `matches` table; handles INSERT and existence check                       |
| DS-LIKE-C8  | UserRepository        | Data access for `users` table; used to validate `targetUserId` existence                  |
| DS-LIKE-C9  | RateLimitMiddleware   | Express middleware wrapping `express-rate-limit`; keyed on authenticated user ID          |

---

## 4. State Diagrams

### 4.1 Swipe Record Lifecycle

Labels: `DS-LIKE-S{n}`

```
                       POST /api/swipes received
                                │
                                ▼
                       DS-LIKE-S1
                       ┌──────────────┐
                       │   PENDING    │
                       │  (in-flight) │
                       └──────┬───────┘
                              │
              ┌───────────────┼────────────────────┐
              │               │                    │
   duplicate  │               │ INSERT OK          │ target user
   swipe found│               │                    │ not found
   (UNIQUE    │               ▼                    │ (400)
   conflict)  │      DS-LIKE-S2                    │
              │      ┌────────────────┐            │
              │      │   RECORDED     │            ▼
              │      │ (row in swipes)│      DS-LIKE-S5
              │      └───────┬────────┘      ┌──────────┐
              │              │               │  FAILED  │
              ▼              │               │ (error)  │
       DS-LIKE-S3            │ match check   └──────────┘
       ┌─────────────┐       │ triggered
       │  DUPLICATE  │       ▼
       │  (409 or    │  DS-LIKE-S4
       │  idempotent)│  ┌──────────────────┐
       └─────────────┘  │  MATCH_CHECKED   │
                        │ (match created   │
                        │  or not — row    │
                        │  in matches if   │
                        │  mutual like)    │
                        └──────────────────┘
```

### 4.2 Match State Machine

Labels: `DS-LIKE-MS{n}`

```
  User A likes User B                User B has already liked User A?
          │                                       │
          ▼                                       │
  DS-LIKE-MS1                          ┌─────────┴──────────┐
  ┌─────────────────┐                  │ No                 │ Yes
  │   NO_MATCH      │◀─────────────────┘                    │
  │ (default state) │                                        │
  └─────────────────┘                                        ▼
                                               DS-LIKE-MS2
                                               ┌─────────────────────┐
                                               │  MATCH_CREATING     │
                                               │ (inside SERIALIZABLE│
                                               │  transaction)       │
                                               └──────────┬──────────┘
                                                          │
                                              ┌───────────┴───────────┐
                                              │ INSERT OK             │ UNIQUE
                                              │                       │ violation
                                              ▼                       │ (concurrent
                                  DS-LIKE-MS3 │                       │  insert)
                                  ┌───────────┴────────┐             │
                                  │  MATCH_CREATED     │◀────────────┘
                                  │ (row in matches,   │  (idempotent —
                                  │  response includes │   match already
                                  │  matched: true)    │   exists)
                                  └────────────────────┘

  Note DS-LIKE-MS4: match row is canonical with user1_id < user2_id (by UUID sort)
  to guarantee the UNIQUE(user1_id, user2_id) constraint catches all duplicates.
```

---

## 5. Flow Charts

### FC-1: Happy Path — Authenticated User Sends POST /api/swipes with action=like

Labels: `DS-LIKE-FC1-{n}`

```
DS-LIKE-FC1-1
┌────────────────────────────────────┐
│ Client sends:                      │
│ POST /api/swipes                   │
│ Authorization: Bearer <JWT>        │
│ { targetUserId, action: "like" }   │
└────────────────────┬───────────────┘
                     │
                     ▼  DS-LIKE-FC1-2
             ┌───────────────┐
             │ AuthMiddleware│
             │ verify JWT    │
             └───────┬───────┘
                     │ valid → req.user.id = swiperId
                     ▼  DS-LIKE-FC1-3
             ┌───────────────────┐
             │ RateLimitMiddle-  │
             │ ware: check quota │
             └───────┬───────────┘
                     │ within limit
                     ▼  DS-LIKE-FC1-4
             ┌───────────────────────┐
             │ SwipeController       │
             │ validate body schema: │
             │ - targetUserId: UUID  │
             │ - action ∈ {like,     │
             │   nope, superlike}    │
             └───────────┬───────────┘
                         │ valid
                         ▼  DS-LIKE-FC1-5
             ┌───────────────────────┐
             │ SwipeService          │
             │ assertNotSelf()       │
             │ assertTargetExists()  │
             └───────────┬───────────┘
                         │ OK
                         ▼  DS-LIKE-FC1-6
             ┌───────────────────────────────┐
             │ SwipeRepository.insert()      │
             │ INSERT INTO swipes            │
             │ (swiper_id, target_id, action)│
             │ ON CONFLICT DO NOTHING        │
             └───────────┬───────────────────┘
                         │ new row inserted
                         ▼  DS-LIKE-FC1-7
             ┌─────────────────────────────────────┐
             │ MatchService.checkAndCreate()        │
             │ BEGIN SERIALIZABLE TRANSACTION       │
             │ SELECT 1 FROM swipes                 │
             │ WHERE swiper_id = targetId           │
             │   AND target_id = swiperId           │
             │   AND action = 'like'                │
             └──────────────┬──────────────────────┘
                            │
              ┌─────────────┴──────────────┐
              │ reverse swipe found?        │
              │ No                         │ Yes
              ▼                            ▼
DS-LIKE-FC1-8                  DS-LIKE-FC1-9
┌──────────────┐        ┌───────────────────────────────┐
│ COMMIT tx    │        │ INSERT INTO matches           │
│ matched:false│        │ (min(a,b), max(a,b))          │
└──────┬───────┘        │ ON CONFLICT DO NOTHING        │
       │                │ COMMIT tx                     │
       │                │ matched: true                 │
       │                └───────────────┬───────────────┘
       │                                │
       └───────────────┬────────────────┘
                       ▼  DS-LIKE-FC1-10
             ┌───────────────────────────┐
             │ HTTP 201 Created          │
             │ {                         │
             │   swipeId: "uuid",        │
             │   matched: true|false,    │
             │   matchId: "uuid"|null    │
             │ }                         │
             └───────────────────────────┘
```

### FC-2: Duplicate Like Attempt (Idempotency / Unique Constraint)

Labels: `DS-LIKE-FC2-{n}`

```
DS-LIKE-FC2-1
┌──────────────────────────────────────┐
│ Authenticated user sends duplicate   │
│ POST /api/swipes                     │
│ same swiperId + targetId as before   │
└──────────────────┬───────────────────┘
                   │
                   ▼  DS-LIKE-FC2-2
         ┌───────────────────────────────┐
         │ Auth + RateLimit pass         │
         │ Body validation passes        │
         └──────────────┬────────────────┘
                        │
                        ▼  DS-LIKE-FC2-3
         ┌──────────────────────────────────────┐
         │ SwipeRepository.insert()             │
         │ INSERT INTO swipes ...               │
         │ ON CONFLICT (swiper_id, target_id)   │
         │ DO NOTHING                           │
         │ RETURNING *                          │
         └──────────────┬───────────────────────┘
                        │
              ┌─────────┴────────────┐
              │ rowCount == 0 ?       │
              │ Yes (conflict)       │ No
              ▼                      ▼ (shouldn't
DS-LIKE-FC2-4                          happen in
┌──────────────────┐                   this branch)
│ HTTP 409 Conflict│
│ {                │
│  error:          │
│  "ALREADY_SWIPED"│
│ }                │
└──────────────────┘

  Note DS-LIKE-FC2-5: The controller may alternatively treat this as idempotent
  and return 200 OK with the original swipe record, depending on product decision.
  The UNIQUE constraint at DB level ensures correctness regardless of choice.
```

### FC-3: Match Detection Flow

Labels: `DS-LIKE-FC3-{n}`

```
DS-LIKE-FC3-1
┌─────────────────────────────────────────┐
│ Swipe INSERT succeeded (new row)         │
│ swiperId = A, targetId = B, action=like │
└───────────────────┬─────────────────────┘
                    │
                    ▼  DS-LIKE-FC3-2
        ┌───────────────────────────────────┐
        │ BEGIN SERIALIZABLE TRANSACTION    │
        └───────────────────┬───────────────┘
                            │
                            ▼  DS-LIKE-FC3-3
        ┌───────────────────────────────────────┐
        │ SELECT id FROM swipes                 │
        │ WHERE swiper_id = B                   │
        │   AND target_id = A                   │
        │   AND action = 'like'                 │
        │ FOR UPDATE                            │
        └───────────────────┬───────────────────┘
                            │
              ┌─────────────┴──────────────────┐
              │ Row found?                      │
              │ No                             │ Yes
              ▼                                ▼
DS-LIKE-FC3-4                     DS-LIKE-FC3-5
┌──────────────────┐              ┌────────────────────────────────────┐
│ COMMIT tx        │              │ Check match already exists?         │
│ return null      │              │ SELECT id FROM matches              │
│ (no match)       │              │ WHERE (user1_id = min(A,B)          │
└──────────────────┘              │   AND user2_id = max(A,B))         │
                                  └────────────────┬───────────────────┘
                                                   │
                                     ┌─────────────┴────────────────┐
                                     │ Match row exists?             │
                                     │ No                           │ Yes
                                     ▼                              ▼
                         DS-LIKE-FC3-6              DS-LIKE-FC3-7
                         ┌──────────────────┐       ┌──────────────────┐
                         │ INSERT INTO      │       │ COMMIT tx        │
                         │ matches          │       │ return existing  │
                         │ (min(A,B),       │       │ match record     │
                         │  max(A,B))       │       └──────────────────┘
                         └────────┬─────────┘
                                  │
                     ┌────────────┴──────────────┐
                     │ INSERT succeeds?           │
                     │ Yes                       │ No (concurrent
                     ▼                           │  UNIQUE conflict)
         DS-LIKE-FC3-8               DS-LIKE-FC3-9
         ┌──────────────────┐        ┌──────────────────────┐
         │ COMMIT tx        │        │ ROLLBACK             │
         │ return new       │        │ Re-query match by    │
         │ match record     │        │ (min(A,B), max(A,B)) │
         │ matched: true    │        │ return existing row  │
         └──────────────────┘        │ matched: true        │
                                     └──────────────────────┘

  DS-LIKE-FC3-10: Canonical key ordering: user1_id = MIN(uuid_A, uuid_B),
  user2_id = MAX(uuid_A, uuid_B). This ensures the UNIQUE constraint fires
  for both (A→B) and (B→A) insertions.
```

---

## 6. Possible Threats and Failures

| Label          | Failure Mode                              | Effect                                                    | Likelihood | Impact | Recovery                                                                                    |
|----------------|-------------------------------------------|-----------------------------------------------------------|------------|--------|---------------------------------------------------------------------------------------------|
| DS-LIKE-T1     | DB connection pool exhausted              | All API calls return 500; app unresponsive                | Low        | High   | Pool timeout throws error; return 503; alert ops; auto-retry with exponential backoff       |
| DS-LIKE-T2     | Duplicate swipe race condition            | Two concurrent identical POSTs; two rows attempted        | Medium     | Low    | `UNIQUE(swiper_id, target_id)` constraint absorbs second INSERT; 409 returned               |
| DS-LIKE-T3     | JWT expiry                                | User submits swipe with stale token                       | High       | Low    | AuthMiddleware returns 401; client refreshes token or prompts re-login                      |
| DS-LIKE-T4     | JWT tampered / invalid signature          | Attacker forges user identity                             | Low        | High   | `jsonwebtoken.verify()` throws; 401 returned; no swipe recorded                            |
| DS-LIKE-T5     | Invalid / non-existent targetUserId       | Client sends UUID for deleted or fake user                | Medium     | Low    | UserRepository.findById returns null; SwipeService throws 400 before any DB write          |
| DS-LIKE-T6     | DB transaction deadlock                   | Two concurrent transactions lock rows in opposite order   | Low        | Medium | PostgreSQL detects deadlock; aborts one tx; service layer catches `40P01` and retries once  |
| DS-LIKE-T7     | Match double-insert race (concurrent)     | Two users like each other within ms; two match INSERTs    | Low        | Low    | `UNIQUE(user1_id, user2_id)` + SERIALIZABLE isolation prevents duplicate; one succeeds     |
| DS-LIKE-T8     | Rate limit bypass (distributed clients)   | Attacker uses multiple IPs or tokens to flood swipes      | Medium     | Medium | Key by `req.user.id` (not IP); per-user limit; suspicious pattern triggers account review  |
| DS-LIKE-T9     | PostgreSQL write failure (disk full)      | INSERT fails mid-request                                  | Very Low   | High   | Transaction rolled back; 500 returned; ops alerted; no partial state written               |
| DS-LIKE-T10    | Self-like (swiperId == targetUserId)      | User sends own ID as target                               | Low        | Low    | SwipeService.assertNotSelf() throws 400 before any DB write                                |

---

## 7. Technologies

| Technology           | Version  | URL                                              | Why Chosen                                                               | Alternatives Considered              |
|----------------------|----------|--------------------------------------------------|--------------------------------------------------------------------------|--------------------------------------|
| Node.js              | 20 LTS   | https://nodejs.org                               | Non-blocking I/O; large ecosystem; team familiarity                      | Python/FastAPI, Go/Gin               |
| Express              | 4.x      | https://expressjs.com                            | Minimal, well-understood HTTP framework; wide middleware ecosystem        | Fastify, Koa, Hono                   |
| PostgreSQL           | 15+      | https://www.postgresql.org                       | ACID transactions; UNIQUE constraints; row-level locking; mature         | MySQL, SQLite, MongoDB               |
| node-postgres (pg)   | 8.x      | https://node-postgres.com                        | Native PG client; connection pooling; parameterized queries              | Sequelize, Prisma, Knex              |
| jsonwebtoken         | 9.x      | https://github.com/auth0/node-jsonwebtoken       | Industry-standard JWT sign/verify; pairs with existing auth system       | Passport.js, jose                    |
| bcrypt               | 5.x      | https://github.com/kelektiv/node.bcrypt.js       | Password hashing at rest; slow-by-design prevents brute force            | argon2, scrypt                       |
| express-rate-limit   | 7.x      | https://github.com/express-rate-limit/express-rate-limit | Simple per-route rate limiting; keyed by user ID                  | Upstash Redis rate limit, nginx      |
| uuid (v4)            | 9.x      | https://github.com/uuidjs/uuid                   | Generate universally unique IDs for swipe and match records              | nanoid, DB-generated UUIDs           |
| dotenv               | 16.x     | https://github.com/motdotla/dotenv               | Load secrets from `.env`; keep credentials out of source control         | config, node-config                  |

---

## 8. APIs

### POST /api/swipes

**Label:** `DS-LIKE-API-1`

| Field            | Value                                          |
|------------------|------------------------------------------------|
| Method           | `POST`                                         |
| Path             | `/api/swipes`                                  |
| Auth Required    | Yes — `Authorization: Bearer <JWT>`            |
| Content-Type     | `application/json`                             |

#### Request Body Schema (DS-LIKE-API-1.1)

```json
{
  "targetUserId": "<UUID v4, required>",
  "action": "like | nope | superlike  (required)"
}
```

Validation rules (DS-LIKE-API-1.2):
- `targetUserId`: non-empty string, valid UUID v4 format
- `action`: one of the string literals `"like"`, `"nope"`, `"superlike"`
- `targetUserId` must not equal the authenticated user's ID

#### Success Response — 201 Created (DS-LIKE-API-1.3)

```json
{
  "swipeId": "550e8400-e29b-41d4-a716-446655440000",
  "action": "like",
  "matched": true,
  "matchId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

When `matched` is `false`, `matchId` is `null`.

#### Error Responses

| Status | Code (DS-LIKE-API-1.x) | Error Body                                                        | Condition                                              |
|--------|------------------------|-------------------------------------------------------------------|--------------------------------------------------------|
| 400    | DS-LIKE-API-1.4        | `{ "error": "VALIDATION_ERROR", "details": "..." }`               | Missing/invalid `targetUserId` or `action`; self-swipe |
| 400    | DS-LIKE-API-1.5        | `{ "error": "USER_NOT_FOUND", "details": "Target user not found"}`| `targetUserId` does not exist in `users` table         |
| 401    | DS-LIKE-API-1.6        | `{ "error": "UNAUTHORIZED", "details": "Invalid or expired token"}`| JWT missing, expired, or invalid signature            |
| 403    | DS-LIKE-API-1.7        | `{ "error": "FORBIDDEN", "details": "..." }`                      | Token valid but user is suspended/banned               |
| 409    | DS-LIKE-API-1.8        | `{ "error": "ALREADY_SWIPED", "details": "Swipe already recorded"}`| Duplicate swipe (same swiperId + targetId)            |
| 429    | DS-LIKE-API-1.9        | `{ "error": "RATE_LIMITED", "details": "Too many requests" }`     | Rate limit exceeded                                    |
| 500    | DS-LIKE-API-1.10       | `{ "error": "INTERNAL_ERROR", "details": "An error occurred" }`   | Unhandled DB or server error                           |

---

## 9. Public Interfaces

Methods called across module boundaries, forming the internal API contract.

| Label          | Caller               | Method Signature                                                                 | Callee              | Notes                                                                 |
|----------------|----------------------|----------------------------------------------------------------------------------|---------------------|-----------------------------------------------------------------------|
| DS-LIKE-I1     | SwipeController      | `swipeService.recordSwipe(swiperId, targetId, action)`                           | SwipeService        | Returns `Promise<SwipeResult>`; throws typed errors on failure        |
| DS-LIKE-I2     | SwipeService         | `userRepo.findById(targetUserId)`                                                | UserRepository      | Returns `Promise<User\|null>`; null triggers 400                      |
| DS-LIKE-I3     | SwipeService         | `swipeRepo.insert(swiperId, targetId, action)`                                   | SwipeRepository     | Returns `Promise<Swipe\|null>`; null = duplicate (conflict)           |
| DS-LIKE-I4     | SwipeService         | `matchService.checkAndCreate(swiperId, targetId)`                                | MatchService        | Returns `Promise<Match\|null>`; null = no mutual like yet             |
| DS-LIKE-I5     | MatchService         | `swipeRepo.findReverse(targetId, swiperId)`                                      | SwipeRepository     | Returns `Promise<Swipe\|null>`; checks if B already liked A           |
| DS-LIKE-I6     | MatchService         | `matchRepo.insert(user1Id, user2Id)`                                             | MatchRepository     | Returns `Promise<Match>`; user1 = min UUID, user2 = max UUID          |
| DS-LIKE-I7     | MatchService         | `matchRepo.findByUsers(user1Id, user2Id)`                                        | MatchRepository     | Returns `Promise<Match\|null>`; used in concurrent-insert fallback    |
| DS-LIKE-I8     | Router (DS-LIKE-C1)  | `authMiddleware.handle(req, res, next)`                                          | AuthMiddleware      | Populates `req.user`; calls `next()` or returns 401                   |
| DS-LIKE-I9     | Router (DS-LIKE-C1)  | `rateLimitMiddleware.handle(req, res, next)`                                     | RateLimitMiddleware | Keyed on `req.user.id`; calls `next()` or returns 429                 |

---

## 10. Data Schemas

PostgreSQL DDL. All labels follow `DS-LIKE-DB-{n}`.

```sql
-- DS-LIKE-DB-1: users table
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DS-LIKE-DB-1.1: Index for login lookup
CREATE INDEX idx_users_email ON users(email);


-- DS-LIKE-DB-2: swipes table
CREATE TABLE swipes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  swiper_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL CHECK (action IN ('like', 'nope', 'superlike')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- DS-LIKE-DB-2.1: Prevents duplicate swipes and is the concurrency guard
  CONSTRAINT uq_swipes_swiper_target UNIQUE (swiper_id, target_id)
);

-- DS-LIKE-DB-2.2: Index for reverse-swipe lookup (match detection hot path)
CREATE INDEX idx_swipes_target_swiper ON swipes(target_id, swiper_id) WHERE action = 'like';

-- DS-LIKE-DB-2.3: Index for fetching all swipes by a user
CREATE INDEX idx_swipes_swiper_id ON swipes(swiper_id);


-- DS-LIKE-DB-3: matches table
CREATE TABLE matches (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- DS-LIKE-DB-3.1: Canonical ordering (user1_id < user2_id as UUIDs) prevents
  -- (A,B) and (B,A) being stored as separate rows.
  CONSTRAINT uq_matches_users UNIQUE (user1_id, user2_id),
  CONSTRAINT chk_matches_ordered CHECK (user1_id < user2_id)
);

-- DS-LIKE-DB-3.2: Index for fetching all matches for a given user
CREATE INDEX idx_matches_user1 ON matches(user1_id);
CREATE INDEX idx_matches_user2 ON matches(user2_id);
```

**Canonical ordering note (DS-LIKE-DB-3.3):** Before inserting into `matches`, the service layer normalizes:
```js
const user1Id = [swiperId, targetId].sort()[0];  // lexicographically smaller UUID
const user2Id = [swiperId, targetId].sort()[1];
```
This ensures the `UNIQUE(user1_id, user2_id)` constraint catches concurrent match insertions from both directions.

---

## 11. Risks to Completion

| Label         | Component          | Risk Category        | Difficulty | Notes                                                                                                                                         |
|---------------|--------------------|----------------------|------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| DS-LIKE-R1    | MatchService       | Concurrency          | High       | Two users liking each other within milliseconds. Mitigated by SERIALIZABLE transaction + UNIQUE(user1_id, user2_id) + canonical key ordering   |
| DS-LIKE-R2    | SwipeRepository    | Concurrency          | Medium     | Duplicate swipe race (double-tap or retry). Mitigated by UNIQUE(swiper_id, target_id) + ON CONFLICT DO NOTHING                                |
| DS-LIKE-R3    | DB Migrations      | Schema               | Medium     | Adding columns or indexes to `swipes` or `matches` on a live DB requires careful migration tooling (e.g., `node-pg-migrate`) to avoid downtime |
| DS-LIKE-R4    | RateLimitMiddleware| Rate Limiting        | Low        | In-memory rate limiting does not persist across server restarts or scale across multiple instances. Use Redis store for multi-instance deploys  |
| DS-LIKE-R5    | AuthMiddleware     | Security             | Low        | JWT secret rotation requires coordinating token re-issuance. Plan a secret rotation strategy before production launch                          |
| DS-LIKE-R6    | SwipeService       | Input Validation     | Low        | UUID format validation must happen before DB query to avoid malformed query parameters causing unexpected errors                               |
| DS-LIKE-R7    | UserRepository     | Performance          | Low        | `findById` called on every swipe request. Mitigate with a short-lived in-memory cache (e.g., 60-second TTL) or rely on PG index speed          |
| DS-LIKE-R8    | PostgreSQL pool    | Infrastructure       | Medium     | Pool exhaustion under traffic spikes. Set `max` pool size carefully; implement queue timeout; expose `/health` endpoint with pool stats        |
| DS-LIKE-R9    | Match response     | Product              | Low        | Deciding whether a 409 (duplicate swipe) should re-check and return match status requires product sign-off — document the decision explicitly  |

---

## 12. Security and Privacy

### 12.1 PII Stored (DS-LIKE-SEC-1)

| Data Element       | Table      | Sensitivity | Retention Policy                      | Protection                                                   | Disposal                               |
|--------------------|------------|-------------|---------------------------------------|--------------------------------------------------------------|----------------------------------------|
| `email`            | `users`    | High (PII)  | Until account deletion                | Stored in plaintext; access restricted to backend only       | DELETE row on account deletion         |
| `password_hash`    | `users`    | High        | Until account deletion                | bcrypt hash (cost ≥ 12); never returned in API responses     | DELETE row on account deletion         |
| `display_name`     | `users`    | Medium      | Until account deletion                | No encryption required; avoid logging                        | DELETE row on account deletion         |
| `swiper_id`        | `swipes`   | Medium      | Configurable (e.g., 2 years)          | UUID pseudonym; no direct PII                                | Purge on retention expiry or deletion  |
| `target_id`        | `swipes`   | Medium      | Same as swiper_id                     | UUID pseudonym                                               | Same as swiper_id                      |
| `user1_id/user2_id`| `matches`  | Medium      | Until match is deleted or users leave | UUID pseudonym                                               | CASCADE DELETE when user row removed   |

**Note DS-LIKE-SEC-1.1:** The swipe history constitutes behavioral data about user preferences. It should be excluded from any analytics export unless users have explicitly consented.

### 12.2 Authentication (DS-LIKE-SEC-2)

- All endpoints under `/api/` require a valid JWT in the `Authorization: Bearer <token>` header.
- Tokens are verified using `jsonwebtoken.verify(token, JWT_SECRET)` where `JWT_SECRET` is loaded from environment variable — never hardcoded.
- Token expiry (`exp` claim) is enforced; expired tokens return 401.
- Recommended expiry: access token 15 minutes; refresh token 7 days (refresh flow out of scope for this spec).
- `req.user.id` (the `sub` claim from the token) is the canonical identity used throughout the swipe pipeline.
- Token payload must include: `{ sub: userId, iat, exp }`.

### 12.3 Authorization (DS-LIKE-SEC-3)

- A user may only record swipes as themselves: `swiperId` is always taken from `req.user.id` (the verified JWT subject), never from the request body.
- The request body provides only `targetUserId` and `action`; the swiper identity is never client-supplied.
- This prevents a user from recording swipes on behalf of another user.
- Admins (if any) are not granted additional swipe permissions and must use a separate admin API if required.

### 12.4 Rate Limiting (DS-LIKE-SEC-4)

- `express-rate-limit` is applied to `POST /api/swipes` before the route handler.
- Limit: **60 requests per 60-second window per authenticated user ID**.
- Key function: `(req) => req.user.id` — keyed on user identity, not IP address (prevents bypass via proxy).
- Response on breach: HTTP 429 with `Retry-After` header.
- **Multi-instance caveat (DS-LIKE-SEC-4.1):** Default `express-rate-limit` uses in-memory store. For horizontally scaled deployments, replace with `rate-limit-redis` store pointing to a shared Redis instance to enforce the limit globally.

### 12.5 Injection & Input Validation (DS-LIKE-SEC-5)

- **Parameterized queries only:** All SQL executed via `pg` (node-postgres) uses `$1, $2, ...` placeholders. String interpolation into SQL is strictly prohibited.

  ```js
  // DS-LIKE-SEC-5.1 — correct usage
  await pool.query(
    'INSERT INTO swipes (swiper_id, target_id, action) VALUES ($1, $2, $3)',
    [swiperId, targetId, action]
  );
  ```

- **Input validation (DS-LIKE-SEC-5.2):** `targetUserId` is validated as a UUID v4 before any DB interaction using a regex or a library such as `uuid` (`validate(id)`). Invalid UUIDs return 400 before touching the database.
- **Enum validation (DS-LIKE-SEC-5.3):** `action` is validated against an explicit allowlist `['like', 'nope', 'superlike']`. No other values reach the repository layer.
- **Body size limit (DS-LIKE-SEC-5.4):** Express JSON body parser is configured with `{ limit: '4kb' }` to prevent payload flooding.

### 12.6 Concurrency & Race Conditions (DS-LIKE-SEC-6)

Two distinct race conditions are addressed:

**Race 1 — Duplicate swipe (DS-LIKE-SEC-6.1):**  
Two identical POST requests arrive simultaneously (e.g., double-tap, network retry).  
Mitigation: `UNIQUE(swiper_id, target_id)` at the DB level. The second INSERT silently fails with a constraint violation; the service layer detects `rowCount === 0` and returns 409. No duplicate swipe row is ever created.

**Race 2 — Concurrent mutual like (DS-LIKE-SEC-6.2):**  
User A and User B like each other at the same millisecond. Both transactions attempt to INSERT into `matches`.  
Mitigation stack:
1. Match INSERT uses canonical ordering `(min(A,B), max(A,B))` so both attempts target the same row.
2. `UNIQUE(user1_id, user2_id)` + `CHECK(user1_id < user2_id)` prevent duplicate match rows.
3. `SERIALIZABLE` transaction isolation on the match-detection block prevents phantom reads between the reverse-swipe SELECT and the match INSERT.
4. The losing transaction receives a `23505` (unique_violation) or `40001` (serialization_failure) error; the service catches both and re-fetches the existing match row, returning `matched: true` to both users.

```
DS-LIKE-SEC-6.3 — Transaction pseudocode:

await pool.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
try {
  const reverse = await pool.query(
    'SELECT id FROM swipes WHERE swiper_id=$1 AND target_id=$2 AND action=$3 FOR UPDATE',
    [targetId, swiperId, 'like']
  );
  if (reverse.rowCount > 0) {
    const [u1, u2] = [swiperId, targetId].sort();
    await pool.query(
      'INSERT INTO matches (user1_id, user2_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [u1, u2]
    );
    const match = await pool.query(
      'SELECT * FROM matches WHERE user1_id=$1 AND user2_id=$2',
      [u1, u2]
    );
    await pool.query('COMMIT');
    return match.rows[0];   // always returns the canonical match
  }
  await pool.query('COMMIT');
  return null;
} catch (err) {
  await pool.query('ROLLBACK');
  throw err;  // caller retries or surfaces 500
}
```
