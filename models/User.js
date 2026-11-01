const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true, default: 'anon', enum: ['anon', 'account'] },
    anonymousId: { type: String, unique: true, sparse: true, trim: true },
    email: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
    displayName: { type: String, trim: true, default: null },
    passwordHash: { type: String, default: null },
    sessionTokenHash: { type: String, unique: true, sparse: true },
    sessionExpiresAt: { type: Date, default: null },
    homeRegion: { type: String, trim: true, lowercase: true, default: 'us' },
    walletBalanceTtkMinor: { type: Number, default: 0 },
    stripeCustomerId: { type: String, default: null, trim: true },
    processedStripeCheckoutSessionIds: { type: [String], default: [] },
    lastMapId: { type: String, default: null, trim: true },
    lastActiveAt: { type: Date, default: Date.now },
  },
  {
    collection: 'users',
    timestamps: true,
  }
);

userSchema.index(
  { lastActiveAt: 1 },
  {
    expireAfterSeconds: 60 * 60,
    partialFilterExpression: { type: 'anon' },
  }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
