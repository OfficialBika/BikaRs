const mongoose = require('mongoose');

const broadcastJobSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['queued', 'active', 'stopping', 'stopped', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    adminId: { type: Number, required: true, index: true },
    sourceChatId: { type: Number, required: true },
    sourceMessageId: { type: Number, required: true },
    sourceReplyMarkup: { type: mongoose.Schema.Types.Mixed, default: null },
    mode: { type: String, enum: ['copy', 'forward'], default: 'copy' },
    target: { type: String, enum: ['all', 'completed'], default: 'all' },
    includeBanned: { type: Boolean, default: false },
    totalCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    lastTelegramId: { type: Number, default: 0 },
    stopRequested: { type: Boolean, default: false, index: true },
    statusChatId: { type: Number, default: 0 },
    statusMessageId: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    errorMessage: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

broadcastJobSchema.index({ status: 1, createdAt: -1 });
broadcastJobSchema.index({ adminId: 1, createdAt: -1 });

module.exports = mongoose.models.BroadcastJob || mongoose.model('BroadcastJob', broadcastJobSchema);
