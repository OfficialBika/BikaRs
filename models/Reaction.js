const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema(
  {
    fromUserId: { type: Number, required: true, index: true },
    toUserId: { type: Number, required: true, index: true },
    type: { type: String, enum: ['like', 'love', 'laugh'], required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

reactionSchema.index({ fromUserId: 1, toUserId: 1 }, { unique: true });

module.exports = mongoose.models.Reaction || mongoose.model('Reaction', reactionSchema);
