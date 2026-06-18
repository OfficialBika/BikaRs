const mongoose = require('mongoose');

const broadcastDeliverySchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: 'BroadcastJob' },
    telegramId: { type: Number, required: true, index: true },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true, index: true },
    errorCode: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

broadcastDeliverySchema.index({ jobId: 1, telegramId: 1 }, { unique: true });
broadcastDeliverySchema.index({ jobId: 1, status: 1 });

module.exports = mongoose.models.BroadcastDelivery || mongoose.model('BroadcastDelivery', broadcastDeliverySchema);
