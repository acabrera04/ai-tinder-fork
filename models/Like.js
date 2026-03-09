const mongoose = require('mongoose');

const likeSchema = new mongoose.Schema({
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
  type: {
    type: String,
    enum: ['like', 'super_like'],
    default: 'like'
  },
  isMatch: {
    type: Boolean,
    default: false
  },
  matchCreatedAt: {
    type: Date
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
likeSchema.index({ fromUser: 1, createdAt: -1 });
likeSchema.index({ toUser: 1, createdAt: -1 });
likeSchema.index({ fromUser: 1, toUser: 1 }, { unique: true });
likeSchema.index({ isMatch: 1, createdAt: -1 });

// Prevent duplicate likes
likeSchema.pre('save', async function(next) {
  if (this.isNew) {
    const existingLike = await this.constructor.findOne({
      fromUser: this.fromUser,
      toUser: this.toUser
    });
    
    if (existingLike) {
      const error = new Error('User has already liked this profile');
      error.code = 'DUPLICATE_LIKE';
      return next(error);
    }
  }
  next();
});

// Check for match when a new like is created
likeSchema.post('save', async function(doc) {
  if (doc.isMatch) return; // Already processed
  
  try {
    // Check if the other user has liked this user back
    const reciprocalLike = await doc.constructor.findOne({
      fromUser: doc.toUser,
      toUser: doc.fromUser,
      isMatch: { $ne: true }
    });
    
    if (reciprocalLike) {
      // Create match
      const Match = mongoose.model('Match');
      const match = new Match({
        users: [doc.fromUser, doc.toUser],
        initiatedBy: doc.fromUser,
        likeId: doc._id,
        reciprocalLikeId: reciprocalLike._id,
        type: doc.type === 'super_like' ? 'super_like_match' : 'mutual_like'
      });
      
      await match.save();
      
      // Update both likes to mark as match
      await doc.constructor.updateOne(
        { _id: doc._id },
        { isMatch: true, matchCreatedAt: new Date() }
      );
      
      await doc.constructor.updateOne(
        { _id: reciprocalLike._id },
        { isMatch: true, matchCreatedAt: new Date() }
      );
      
      // Update user stats
      const User = mongoose.model('User');
      await User.updateOne(
        { _id: doc.fromUser },
        { $inc: { 'stats.matches': 1 } }
      );
      
      await User.updateOne(
        { _id: doc.toUser },
        { $inc: { 'stats.matches': 1 } }
      );
    }
  } catch (error) {
    console.error('Error checking for match:', error);
  }
});

module.exports = mongoose.model('Like', likeSchema);
