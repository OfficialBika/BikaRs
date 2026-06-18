const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reporterId: { type: Number, required: true, index: true },
    targetUserId: { type: Number, required: true, index: true },
    reason: { type: String, default: 'အတုအယောင် profile' },
    status: { type: String, enum: ['pending', 'ignored', 'resolved'], default: 'pending', index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

reportSchema.index({ reporterId: 1, targetUserId: 1 }, { unique: true });

module.exports = mongoose.models.Report || mongoose.model('Report', reportSchema);
