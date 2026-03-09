const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  _id: {
    type: mongoose.Schema.Types.ObjectId,
    auto: true
  },
  users: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  likeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Like',
    required: true
  },
  reciprocalLikeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Like',
    required: true
  },
  type: {
    type: String,
    enum: ['mutual_like', 'super_like_match'],
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastMessageAt: {
    type: Date
  },
  messages: [{
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: true,
      maxlength: 1000
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'gif'],
      default: 'text'
    },
    isRead: {
      type: Boolean,
      default: false
    },
    readAt: {
      type: Date
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Only return messages for the requesting user
      return ret;
    }
  }
});

// Indexes for performance
matchSchema.index({ users: 1 });
matchSchema.index({ initiatedBy: 1 });
matchSchema.index({ isActive: 1, lastMessageAt: -1 });
matchSchema.index({ createdAt: -1 });

// Ensure users array always has exactly 2 users
matchSchema.pre('save', function(next) {
  if (this.users.length !== 2) {
    return next(new Error('Match must have exactly 2 users'));
  }
  next();
});

// Virtual for unread message count
matchSchema.virtual('unreadCount').get(function() {
  return this.messages.filter(msg => !msg.isRead).length;
});

// Method to add a message
matchSchema.methods.addMessage = async function(fromUserId, content, messageType = 'text') {
  // Verify the sender is part of the match
  if (!this.users.includes(fromUserId)) {
    throw new Error('User is not part of this match');
  }
  
  const message = {
    fromUser: fromUserId,
    content,
    messageType,
    isRead: false,
    createdAt: new Date()
  };
  
  this.messages.push(message);
  this.lastMessageAt = new Date();
  
  await this.save();
  
  // Mark previous messages from other user as read
  const otherUserId = this.users.find(id => !id.equals(fromUserId));
  await this.constructor.updateOne(
    { 
      _id: this._id,
      'messages.fromUser': otherUserId,
      'messages.isRead': false
    },
    { 
      $set: { 
        'messages.$.isRead': true,
        'messages.$.readAt': new Date()
      }
    }
  );
  
  return message;
};

// Method to get match partner
matchSchema.methods.getPartner = function(userId) {
  return this.users.find(id => !id.equals(userId));
};

module.exports = mongoose.model('Match', matchSchema);
