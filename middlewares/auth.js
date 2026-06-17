const User = require('../models/User');
const { ADMIN_IDS } = require('../config/env');

function isAdmin(id) {
  return ADMIN_IDS.includes(Number(id));
}

async function upsertTelegramUser(ctx) {
  const from = ctx.from || {};
  if (!from.id) return null;

  const update = {
    telegramId: Number(from.id),
    username: from.username || '',
    tgFirstName: from.first_name || '',
    tgLastName: from.last_name || '',
    updatedAt: new Date(),
  };

  return User.findOneAndUpdate(
    { telegramId: Number(from.id) },
    { $set: update, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, new: true }
  );
}

async function authMiddleware(ctx, next) {
  if (!ctx.from || !ctx.from.id) return next();

  const user = await upsertTelegramUser(ctx);
  ctx.state.dbUser = user;

  if (user?.isBanned && !isAdmin(ctx.from.id)) {
    if (ctx.updateType === 'message' || ctx.updateType === 'callback_query') {
      try {
        if (ctx.updateType === 'callback_query') {
          await ctx.answerCbQuery('သင်၏ အကောင့်ကို ပိတ်ထားပါသည်။', { show_alert: true });
        } else {
          await ctx.reply('🚫 သင်၏ အကောင့်ကို ပိတ်ထားပါသည်။');
        }
      } catch (_) {}
    }
    return;
  }

  return next();
}

module.exports = {
  isAdmin,
  upsertTelegramUser,
  authMiddleware,
};
