const User = require('../models/User');
const { requirePrivateChat } = require('../middlewares/privateOnly');
const { reactionEmoji, mainMenuKeyboard } = require('../utils/keyboards');
const { toggleReaction } = require('../services/reactionService');
const { createReport } = require('../services/reportService');
const { sendReactionNotification } = require('../services/notificationService');
const { getProfileByTelegramId, getBrowseList, showGenderList, isPremiumActiveUser } = require('./profile');

function registerMatchCommands(bot) {
  bot.hears('👧 Girls List', async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;

    const me = await getProfileByTelegramId(ctx.from.id);
    if (!me || !me.isProfileComplete) {
      await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
      return;
    }
    await showGenderList(ctx, 'female', 0);
  });

  bot.hears('👦 Boys List', async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;

    const me = await getProfileByTelegramId(ctx.from.id);
    if (!me || !me.isProfileComplete) {
      await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
      return;
    }
    await showGenderList(ctx, 'male', 0);
  });

  bot.hears('🎲 ကျပန်း Profile ကြည့်ရန်', async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;

    const me = await getProfileByTelegramId(ctx.from.id);
    if (!me || !me.isProfileComplete) {
      await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
      return;
    }

    const genderLists = await Promise.all(
      ['female', 'male'].map(async (gender) => ({
        gender,
        list: await getBrowseList(gender, ctx.from.id),
      }))
    );

    const premiumPool = genderLists.flatMap(({ gender, list }) =>
      list.filter((user) => isPremiumActiveUser(user)).map((user) => ({ gender, user }))
    );
    const normalPool = genderLists.flatMap(({ gender, list }) =>
      list.filter((user) => !isPremiumActiveUser(user)).map((user) => ({ gender, user }))
    );

    const pool = premiumPool.length ? premiumPool : normalPool;
    if (!pool.length) {
      await ctx.reply('ကြည့်ရှုရန် profile မရှိသေးပါ။', mainMenuKeyboard());
      return;
    }

    const picked = pool[Math.floor(Math.random() * pool.length)];
    const targetList = genderLists.find((item) => item.gender === picked.gender)?.list || [];
    const index = Math.max(
      0,
      targetList.findIndex((user) => Number(user.telegramId) === Number(picked.user.telegramId))
    );

    await showGenderList(ctx, picked.gender, index);
  });

  bot.action(/^nav:(male|female):(\d+)$/, async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;

    const [, gender, index] = ctx.match;
    await ctx.answerCbQuery();
    await showGenderList(ctx, gender, Number(index));
  });

  bot.action(/^rx:(like|love|laugh):(\d+):(male|female):(\d+)$/, async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;

    const [, type, targetIdRaw, gender, indexRaw] = ctx.match;
    const targetId = Number(targetIdRaw);
    const index = Number(indexRaw);
    const fromId = Number(ctx.from.id);

    if (fromId === targetId) {
      await ctx.answerCbQuery('ကိုယ့် profile ကို reaction မပေးနိုင်ပါ။', { show_alert: true });
      return;
    }

    const targetUser = await User.findOne({ telegramId: targetId, isProfileComplete: true, isBanned: false });
    if (!targetUser) {
      await ctx.answerCbQuery('Profile မတွေ့ပါ။', { show_alert: true });
      return;
    }

    const reactionResult = await toggleReaction({
      fromUserId: fromId,
      toUserId: targetId,
      type,
    });

    const notifyReactionType = reactionResult.notifyType;
    const message = reactionResult.action === 'removed'
      ? `${reactionEmoji(type)} reaction ကို ပြန်ဖျက်ပြီးပါပြီ။`
      : reactionResult.action === 'changed'
        ? `${reactionEmoji(type)} reaction ကို ပြောင်းလဲပြီးပါပြီ။`
        : `${reactionEmoji(type)} reaction ပေးပြီးပါပြီ။`;

    if (notifyReactionType) {
      try {
        const emoji = reactionEmoji(notifyReactionType);
        const updatedUser = await User.findOne({ telegramId: targetId });
        await sendReactionNotification(
          bot,
          targetId,
          emoji,
          updatedUser?.reactions?.[notifyReactionType] || 0
        );
      } catch (_) {}
    }

    await ctx.answerCbQuery(message);
    await showGenderList(ctx, gender, index);
  });

  bot.action(/^report:(\d+):(male|female):(\d+)$/, async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;

    const [, targetIdRaw, gender, indexRaw] = ctx.match;
    const targetId = Number(targetIdRaw);
    const index = Number(indexRaw);
    const fromId = Number(ctx.from.id);

    if (fromId === targetId) {
      await ctx.answerCbQuery('ကိုယ့် profile ကို report မလုပ်နိုင်ပါ။', { show_alert: true });
      return;
    }

    await createReport({
      reporterId: fromId,
      targetUserId: targetId,
    });

    await ctx.answerCbQuery('🚨 Report ပို့ပြီးပါပြီ။');
    await showGenderList(ctx, gender, index);
  });
}

module.exports = {
  registerMatchCommands,
};
