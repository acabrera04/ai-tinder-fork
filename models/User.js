const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  _id: {
    type: mongoose.Schema.Types.ObjectId,
    auto: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  profile: {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50
    },
    age: {
      type: Number,
      required: true,
      min: 18,
      max: 100
    },
    bio: {
      type: String,
      maxlength: 500,
      trim: true
    },
    location: {
      type: String,
      required: true,
      trim: true
    },
    job: {
      type: String,
      trim: true,
      maxlength: 100
    },
    tags: [{
      type: String,
      trim: true,
      maxlength: 30
    }],
    images: [{
      url: {
        type: String,
        required: true
      },
      isPrimary: {
        type: Boolean,
        default: false
      }
    }]
  },
  preferences: {
    ageRange: {
      min: {
        type: Number,
        default: 18,
        min: 18,
        max: 100
      },
      max: {
        type: Number,
        default: 100,
        min: 18,
        max: 100
      }
    },
    maxDistance: {
      type: Number,
      default: 50,
      min: 1,
      max: 500
    },
    interestedIn: [{
      type: String,
      enum: ['male', 'female', 'non-binary', 'other']
    }]
  },
  stats: {
    likesGiven: {
      type: Number,
      default: 0
    },
    likesReceived: {
      type: Number,
      default: 0
    },
    superLikesGiven: {
      type: Number,
      default: 0
    },
    superLikesReceived: {
      type: Number,
      default: 0
    },
    rejects: {
      type: Number,
      default: 0
    },
    matches: {
      type: Number,
      default: 0
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.password;
      return ret;
    }
  }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ 'profile.location': 1 });
userSchema.index({ isActive: 1, lastActive: -1 });
userSchema.index({ 'profile.age': 1 });
userSchema.index({ 'preferences.ageRange.min': 1, 'preferences.ageRange.max': 1 });

// Password hashing middleware
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Password comparison method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Update last active timestamp
userSchema.methods.updateLastActive = function() {
  this.lastActive = new Date();
  return this.save();
};

// Virtual for profile completion percentage
userSchema.virtual('profileCompletion').get(function() {
  const profile = this.profile;
  let completed = 0;
  let total = 6; // name, age, bio, location, job, images
  
  if (profile.name) completed++;
  if (profile.age) completed++;
  if (profile.bio) completed++;
  if (profile.location) completed++;
  if (profile.job) completed++;
  if (profile.images && profile.images.length > 0) completed++;
  
  return Math.round((completed / total) * 100);
});

module.exports = mongoose.model('User', userSchema);
