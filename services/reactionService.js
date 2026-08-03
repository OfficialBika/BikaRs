const mongoose = require('mongoose');
const Reaction = require('../models/Reaction');
const User = require('../models/User');

async function toggleReaction({ fromUserId, toUserId, type }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const target = await User.findOne({
        telegramId: toUserId,
        isProfileComplete: true,
        isBanned: false,
        isHidden: false,
      }).session(session);

      if (!target) throw new Error('PROFILE_NOT_FOUND');

      const existing = await Reaction.findOne({ fromUserId, toUserId }).session(session);

      if (!existing) {
        await Reaction.create([{ fromUserId, toUserId, type }], { session });
        await User.updateOne(
          { telegramId: toUserId },
          { $inc: { [`reactions.${type}`]: 1 } },
          { session }
        );
        result = { action: 'created', notifyType: type };
        return;
      }

      if (existing.type === type) {
        await Reaction.deleteOne({ _id: existing._id }, { session });
        await User.updateOne(
          { telegramId: toUserId },
          { $inc: { [`reactions.${type}`]: -1 } },
          { session }
        );
        result = { action: 'removed', notifyType: null };
        return;
      }

      await Reaction.updateOne({ _id: existing._id }, { type, updatedAt: new Date() }, { session });
      await User.updateOne(
        { telegramId: toUserId },
        {
          $inc: {
            [`reactions.${existing.type}`]: -1,
            [`reactions.${type}`]: 1,
          },
        },
        { session }
      );

      result = { action: 'changed', notifyType: type };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { toggleReaction };
