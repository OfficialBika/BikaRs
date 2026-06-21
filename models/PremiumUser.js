const mongoose = require('mongoose');

const premiumUserSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, default: '', index: true },
    profileId: { type: Number, default: 0, index: true },
    grantedBy: { type: Number, required: true, index: true },
    durationDays: { type: Number, default: 0 },
    startsAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

premiumUserSchema.index({ telegramId: 1, isActive: 1 });
premiumUserSchema.index({ expiresAt: 1, isActive: 1 });

module.exports = mongoose.models.PremiumUser || mongoose.model('PremiumUser', premiumUserSchema);
