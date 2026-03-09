# Development Specifications

## Like Feature

### Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   UI Layer      │    │  Business Logic │    │   Data Layer    │
│                 │    │                 │    │                 │
│ - Card Component│◄──►│ - LikeService   │◄──►│ - UserStore     │
│ - Like Button   │    │ - Validation    │    │ - MatchEngine   │
│ - Animations    │    │ - RateLimiting  │    │ - Analytics     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Class Diagram
```
class LikeService {
  +likeProfile(userId: string, profileId: string): Promise<LikeResult>
  +validateLike(userId: string, profileId: string): boolean
  +checkRateLimit(userId: string): boolean
  -recordLike(userId: string, profileId: string): void
  -checkForMatch(userId: string, profileId: string): Promise<Match?>
}

class CardComponent {
  +onSwipeRight(): void
  +onLikeButtonClick(): void
  +animateLike(): void
  -removeCard(): void
  -triggerHapticFeedback(): void
}

class UserStore {
  +addLike(userId: string, profileId: string): Promise<void>
  +getLikedProfiles(userId: string): Promise<Profile[]>
  +checkIfLiked(userId: string, profileId: string): Promise<boolean>
}
```

### State Diagram
```
[Card Visible] --> Swipe Right --> [Processing Like]
[Card Visible] --> Click Like --> [Processing Like]
[Processing Like] --> Success --> [Card Removed]
[Processing Like] --> Error --> [Show Error]
[Card Removed] --> Check Match --> [Match Found?]
[Match Found?] --> Yes --> [Match Animation]
[Match Found?] --> No --> [Next Card]
```

### Security Risks & Mitigations
- **Like Injection**: Validate all like requests server-side with CSRF tokens
- **Rate Limiting Bypass**: Implement exponential backoff and IP-based limits
- **Profile Enumeration**: Randomize profile IDs and validate access permissions
- **Data Privacy**: Encrypt user preferences and like history at rest
- **Session Hijacking**: Use secure HTTP-only cookies and implement session rotation

### Scalability Considerations
- **Database Sharding**: Shard user data by geographic region or user ID hash
- **Caching Layer**: Redis cache for frequently accessed profiles and like status
- **Load Balancing**: Horizontal scaling of like service instances
- **Async Processing**: Queue like events for batch processing of matches
- **CDN Distribution**: Cache static assets and profile images globally

---

## Reject Feature

### Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   UI Layer      │    │  Business Logic │    │   Data Layer    │
│                 │    │                 │    │                 │
│ - Card Component│◄──►│ - RejectService │◄──►│ - UserStore     │
│ - Reject Button │    │ - Validation    │    │ - ProfilePool   │
│ - Swipe Handler │    │ - Analytics     │    │ - ML Engine     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Class Diagram
```
class RejectService {
  +rejectProfile(userId: string, profileId: string): Promise<RejectResult>
  +validateReject(userId: string, profileId: string): boolean
  -recordRejection(userId: string, profileId: string): void
  -updateMLModel(userId: string, profileId: string): void
  -removeFromPool(userId: string, profileId: string): void
}

class SwipeHandler {
  +onSwipeLeft(): void
  +detectSwipeGesture(): SwipeDirection
  +calculateSwipeVelocity(): number
  -handleThreshold(): boolean
}

class ProfilePool {
  +removeProfile(userId: string, profileId: string): void
  +getNextProfile(userId: string): Promise<Profile>
  +updatePreferences(userId: string, rejectionData: object): void
}
```

### State Diagram
```
[Card Visible] --> Swipe Left --> [Processing Reject]
[Card Visible] --> Click Reject --> [Processing Reject]
[Processing Reject] --> Success --> [Card Removed]
[Processing Reject] --> Error --> [Show Error]
[Card Removed] --> Update ML --> [Preferences Updated]
[Preferences Updated] --> Next Card --> [New Card Visible]
```

### Security Risks & Mitigations
- **Reject Spam**: Implement rate limiting and CAPTCHA for rapid rejections
- **ML Model Poisoning**: Validate rejection patterns and detect anomalies
- **Profile Manipulation**: Audit rejection trails and implement fraud detection
- **Data Leakage**: Minimize rejection data exposure and use anonymization
- **Replay Attacks**: Use nonce-based request validation

### Scalability Considerations
- **Event Streaming**: Use Kafka/Kinesis for real-time rejection event processing
- **Microservices**: Separate ML training from real-time rejection processing
- **Database Optimization**: Time-series database for rejection analytics
- **Edge Computing**: Process rejections closer to users for reduced latency
- **Auto-scaling**: Dynamic scaling based on rejection volume patterns

---

## Super Like Feature

### Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   UI Layer      │    │  Business Logic │    │   Data Layer    │
│                 │    │                 │    │                 │
│ - Card Component│◄──►│ - SuperLikeSvc  │◄──►│ - UserStore     │
│ - SuperLike Btn │    │ - QuotaManager  │    │ - Notification  │
│ - Star Animation│    │ - PriorityQueue │    │ - Analytics     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Class Diagram
```
class SuperLikeService {
  +superLikeProfile(userId: string, profileId: string): Promise<SuperLikeResult>
  +checkQuota(userId: string): Promise<QuotaStatus>
  +consumeQuota(userId: string): Promise<void>
  -resetDailyQuota(): void
  -sendNotification(targetUserId: string, sourceUserId: string): void
  -prioritizeMatch(userId: string, profileId: string): void
}

class QuotaManager {
  +getRemainingQuota(userId: string): Promise<number>
  +getLastResetTime(userId: string): Promise<Date>
  +isQuotaAvailable(userId: string): Promise<boolean>
  -scheduleReset(userId: string): void
}

class NotificationService {
  +sendSuperLikeNotification(targetUserId: string, sourceProfile: Profile): Promise<void>
  +queueNotification(notification: Notification): void
  -formatNotificationMessage(profile: Profile): string
}
```

### State Diagram
```
[Card Visible] --> Swipe Up --> [Check Quota]
[Card Visible] --> Click Star --> [Check Quota]
[Check Quota] --> Available --> [Processing Super Like]
[Check Quota] --> Unavailable --> [Show Quota Error]
[Processing Super Like] --> Success --> [Card Removed + Notification]
[Processing Super Like] --> Error --> [Show Error]
[Card Removed] --> High Priority --> [Priority Match Queue]
```

### Security Risks & Mitigations
- **Quota Circumvention**: Server-side quota enforcement with atomic operations
- **Notification Spam**: Rate limit notifications and implement user preferences
- **Privilege Escalation**: Strict access controls on super like functionality
- **Timing Attacks**: Randomize notification delivery times
- **Data Mining**: Limit super like data exposure and implement aggregation delays

### Scalability Considerations
- **Quota Management**: Distributed counters with Redis Cluster for quota tracking
- **Priority Queuing**: Separate high-priority match processing pipeline
- **Notification Scaling**: Push notification services with message queuing
- **Analytics Pipeline**: Real-time analytics for super like effectiveness
- **Geographic Distribution**: Regional quota reset schedules to prevent load spikes

---

## Cross-Cutting Concerns

### Data Protection
- **Encryption**: AES-256 encryption for all sensitive user data
- **Access Control**: Role-based access control (RBAC) with principle of least privilege
- **Audit Logging**: Comprehensive audit trails for all user actions
- **Data Retention**: Configurable data retention policies with automatic cleanup
- **Compliance**: GDPR/CCPA compliance with data portability and deletion rights

### Performance Monitoring
- **Metrics**: Response times, error rates, and user engagement metrics
- **Alerting**: Real-time alerts for performance degradation
- **Load Testing**: Regular load testing scenarios for peak traffic
- **Profiling**: Application performance monitoring (APM) integration

### Deployment Architecture
- **Containerization**: Docker containers with Kubernetes orchestration
- **Blue-Green Deployment**: Zero-downtime deployments with traffic shifting
- **Health Checks**: Comprehensive health checks for all service dependencies
- **Rollback Strategy**: Automated rollback procedures for failed deployments
