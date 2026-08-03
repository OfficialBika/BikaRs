const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['photo', 'video'], required: true },
    fileId: { type: String, required: true },
    fileUniqueId: { type: String, default: '' },
    backupChatId: { type: Number, default: 0 },
    backupMessageId: { type: Number, default: 0 },
    backupAction: { type: String, enum: ['create', 'add', 'update', 'legacy'], default: 'create' },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false, versionKey: false }
);

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, unique: true, required: true, index: true },
    // Public sequential profile ID. Assigned only after profile is complete.
    profileId: { type: Number, unique: true, sparse: true, index: true },
    username: { type: String, default: '' },
    tgFirstName: { type: String, default: '' },
    tgLastName: { type: String, default: '' },
    profileName: { type: String, default: '' },
    gender: { type: String, enum: ['male', 'female', ''], default: '' },
    relationshipStatus: { type: String, default: '' },
    age: { type: Number, default: 0 },
    height: { type: String, default: '' },
    address: { type: String, default: '' },
    hobby: { type: String, default: '' },

    // Backward compatibility for older one-photo profiles.
    photoFileId: { type: String, default: '' },

    // New media system: photo/video metadata only. Actual files are kept by Telegram,
    // and a backup copy is posted in CUPID_DATABASE_CHANNEL_ID.
    media: { type: [mediaSchema], default: [] },

    isProfileComplete: { type: Boolean, default: false, index: true },
    isBanned: { type: Boolean, default: false, index: true },
    isHidden: { type: Boolean, default: false, index: true },
    reactions: {
      like: { type: Number, default: 0 },
      love: { type: Number, default: 0 },
      laugh: { type: Number, default: 0 },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

userSchema.index({
  isProfileComplete: 1,
  isBanned: 1,
  isHidden: 1,
  gender: 1,
  age: 1,
  createdAt: -1,
});

userSchema.index({ username: 1 });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
