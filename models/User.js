const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, unique: true, required: true, index: true },
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
    photoFileId: { type: String, default: '' },
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

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
