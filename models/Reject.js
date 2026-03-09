const mongoose = require('mongoose');

const rejectSchema = new mongoose.Schema({
  _id: {
    type: mongoose.Schema.Types.ObjectId,
    auto: true
  },
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  toUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  reason: {
    type: String,
    enum: ['swipe_left', 'explicit_reject'],
    default: 'swipe_left'
  },
  mlFeatures: {
    swipeVelocity: Number,
    timeOnProfile: Number,
    profileCompletionScore: Number,
    tagCompatibility: Number,
    distanceScore: Number
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Compound indexes for performance
rejectSchema.index({ fromUser: 1, createdAt: -1 });
rejectSchema.index({ toUser: 1, createdAt: -1 });
rejectSchema.index({ fromUser: 1, toUser: 1 }, { unique: true });

// Prevent duplicate rejects
rejectSchema.pre('save', async function(next) {
  if (this.isNew) {
    const existingReject = await this.constructor.findOne({
      fromUser: this.fromUser,
      toUser: this.toUser
    });
    
    if (existingReject) {
      const error = new Error('User has already rejected this profile');
      error.code = 'DUPLICATE_REJECT';
      return next(error);
    }
  }
  next();
});

// Update ML model and user preferences after rejection
rejectSchema.post('save', async function(doc) {
  try {
    // Update user stats
    const User = mongoose.model('User');
    await User.updateOne(
      { _id: doc.fromUser },
      { 
        $inc: { 'stats.rejects': 1 },
        $set: { lastActive: new Date() }
      }
    );
    
    // Queue ML model update (in production, this would be a background job)
    if (doc.mlFeatures) {
      // This would typically be sent to a message queue for async processing
      console.log('ML features captured for model update:', {
        userId: doc.fromUser,
        rejectedUserId: doc.toUser,
        features: doc.mlFeatures
      });
    }
    
    // Remove profile from user's pool (if using a recommendation pool)
    const { getRedisClient } = require('../config/redis');
    const redis = getRedisClient();
    
    const poolKey = `user_pool:${doc.fromUser}`;
    await redis.sRem(poolKey, doc.toUser.toString());
    
  } catch (error) {
    console.error('Error processing reject post-save:', error);
  }
});

module.exports = mongoose.model('Reject', rejectSchema);
