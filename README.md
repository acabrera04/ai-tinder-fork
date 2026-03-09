# AI Tinder Clone

An AI-generated dating app clone with frontend and backend components.

## Frontend

A static HTML/CSS/JavaScript Tinder-like interface.

### Running the Frontend

```bash
# Navigate to the project directory
cd ai-tinder-fork

# Start a simple HTTP server (Python 3)
python -m http.server 8000

# Or using Node.js
npx http-server -p 8000
```

Open `http://localhost:8000` in your browser.

## Backend

A Node.js/Express API with MongoDB and Redis for the dating app functionality.

### Features

- User authentication with JWT
- Profile management
- Like, Super Like, and Reject actions
- Match creation and messaging
- Rate limiting and security
- Scalable architecture with Redis caching

### Prerequisites

- Node.js (v18+)
- MongoDB
- Redis

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:3000`

### API Endpoints

#### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/refresh` - Refresh JWT token

#### Profiles
- `GET /api/profiles/me` - Get current user profile
- `PUT /api/profiles/me` - Update user profile
- `GET /api/profiles/potential` - Get potential matches
- `GET /api/profiles/:userId` - Get specific profile
- `PUT /api/profiles/me/preferences` - Update preferences

#### Likes
- `POST /api/likes` - Like a profile
- `GET /api/likes/my-likes` - Get user's liked profiles
- `GET /api/likes/received` - Get profiles that liked user
- `GET /api/likes/matches` - Get matches

#### Super Likes
- `POST /api/super-likes` - Super like a profile
- `GET /api/super-likes/quota` - Get super like quota info
- `GET /api/super-likes/my-super-likes` - Get user's super liked profiles

#### Rejects
- `POST /api/rejects` - Reject a profile
- `GET /api/rejects/my-rejects` - Get user's rejected profiles

### Security Features

- JWT authentication with token blacklisting
- Rate limiting per user and globally
- Input validation and sanitization
- CORS configuration
- Helmet for security headers
- Password hashing with bcrypt
- Data encryption at rest

### Scalability Features

- Redis caching for profiles and actions
- Database indexing for performance
- Horizontal scaling support
- Message queuing for notifications
- Distributed quota management

### Environment Variables

See `.env.example` for all required environment variables.

## Architecture

### Backend Structure
```
├── config/
│   ├── database.js      # MongoDB connection
│   └── redis.js         # Redis connection
├── middleware/
│   └── auth.js          # Authentication middleware
├── models/
│   ├── User.js          # User model
│   ├── Like.js          # Like model
│   ├── Reject.js        # Reject model
│   └── Match.js         # Match model
├── routes/
│   ├── auth.js          # Auth routes
│   ├── profiles.js      # Profile routes
│   ├── likes.js         # Like routes
│   ├── superLikes.js    # Super like routes
│   └── rejects.js       # Reject routes
├── services/
│   ├── LikeService.js         # Like business logic
│   ├── RejectService.js       # Reject business logic
│   ├── SuperLikeService.js    # Super like business logic
│   ├── QuotaManager.js        # Quota management
│   └── NotificationService.js # Notification handling
├── utils/
│   └── logger.js        # Winston logger
├── server.js            # Main server file
└── package.json
```

## Development

### Running Tests
```bash
npm test
```

### Linting
```bash
npm run lint
```

## License

MIT License
