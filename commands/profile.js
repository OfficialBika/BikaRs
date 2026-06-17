const { Markup } = require('telegraf');
const User = require('../models/User');
const { ALLOWED_STATUSES } = require('../config/env');
const { requirePrivateChat } = require('../middlewares/privateOnly');
const { escapeHtml, safeTextLength } = require('../utils/escapeHtml');
const {
  mainMenuKeyboard,
  genderLabel,
  buildProfileCaption,
  buildProfileButtons,
} = require('../utils/keyboards');

function resetProfileSession(ctx) {
  ctx.session.profileFlow = {
    active: false,
    step: '',
    data: {},
    editing: false,
  };
}

function ensureSessionDefaults(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.profileFlow) resetProfileSession(ctx);
}

function profileSessionMiddleware(ctx, next) {
  ensureSessionDefaults(ctx);
  return next();
}

async function getProfileByTelegramId(telegramId) {
  return User.findOne({ telegramId: Number(telegramId) });
}

async function getBrowseList(gender, viewerId) {
  return User.find({
    gender,
    isProfileComplete: true,
    isBanned: false,
    isHidden: false,
    telegramId: { $ne: Number(viewerId) },
  })
    .sort({ createdAt: 1, telegramId: 1 })
    .lean();
}

async function sendOrEditProfileCard(ctx, user, gender, index, total, options = {}) {
  const caption = buildProfileCaption(user, index, total);
  const keyboard = buildProfileButtons(user, gender, index, total, options.isAdminView);

  try {
    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageMedia(
        {
          type: 'photo',
          media: user.photoFileId,
          caption,
          parse_mode: 'HTML',
        },
        {
          reply_markup: keyboard.reply_markup,
        }
      );
      return;
    }

    await ctx.replyWithPhoto(user.photoFileId, {
      caption,
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
    });
  } catch (error) {
    try {
      if (ctx.updateType === 'callback_query') {
        await ctx.editMessageCaption(caption, {
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup,
        });
        return;
      }
    } catch (_) {}

    await ctx.replyWithPhoto(user.photoFileId, {
      caption,
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
    });
  }
}

async function showGenderList(ctx, gender, startIndex = 0, isAdminView = false) {
  const viewerId = ctx.from?.id;
  const list = await getBrowseList(gender, viewerId);

  if (!list.length) {
    const text = gender === 'female'
      ? '👧 Girls List ထဲမှာ profile မရှိသေးပါ။'
      : '👦 Boys List ထဲမှာ profile မရှိသေးပါ။';

    if (ctx.updateType === 'callback_query') {
      await ctx.answerCbQuery();
      try {
        await ctx.editMessageText(text, {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Main Menu', 'main:menu')],
          ]).reply_markup,
        });
        return;
      } catch (_) {}
    }

    await ctx.reply(text, mainMenuKeyboard());
    return;
  }

  let index = Number(startIndex) || 0;
  if (list.length > 0) {
    index = ((index % list.length) + list.length) % list.length;
  }

  await sendOrEditProfileCard(ctx, list[index], gender, index, list.length, { isAdminView });
}

async function showMyProfile(ctx) {
  if (!(await requirePrivateChat(ctx))) return;

  const user = await getProfileByTelegramId(ctx.from.id);
  if (!user || !user.isProfileComplete) {
    await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
    return;
  }

  const caption = [
    '👤 <b>ကျွန်ုပ်၏ Profile</b>',
    '',
    `👤 <b>နာမည်:</b> ${escapeHtml(user.profileName || '-')}`,
    `⚧ <b>လိင်:</b> ${escapeHtml(genderLabel(user.gender))}`,
    `💞 <b>လက်ရှိအခြေအနေ:</b> ${escapeHtml(user.relationshipStatus || '-')}`,
    `🎂 <b>အသက်:</b> ${escapeHtml(user.age || '-')}`,
    `📏 <b>အရပ်အမြင့်:</b> ${escapeHtml(user.height || '-')}`,
    `📍 <b>နေရပ်လိပ်စာ:</b> ${escapeHtml(user.address || '-')}`,
    `🎯 <b>ဝါသနာ:</b> ${escapeHtml(user.hobby || '-')}`,
    `🆔 <b>Username:</b> ${user.username ? `@${escapeHtml(user.username)}` : 'မရှိသေးပါ'}`,
    '',
    `👍 ${user.reactions?.like || 0}   ❤ ${user.reactions?.love || 0}   🤣 ${user.reactions?.laugh || 0}`,
  ].join('\n');

  await ctx.replyWithPhoto(user.photoFileId, {
    caption,
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Profile ပြင်ရန်', 'edit:profile')],
      [Markup.button.callback(user.isHidden ? '👁 Profile ပြန်ပြရန်' : '🙈 Profile ဖျောက်ရန်', 'toggle:hide')],
    ]).reply_markup,
  });
}

async function startProfileFlow(ctx, editing = false) {
  if (!(await requirePrivateChat(ctx))) return;

  ensureSessionDefaults(ctx);
  const existing = await getProfileByTelegramId(ctx.from.id);

  ctx.session.profileFlow = {
    active: true,
    step: 'name',
    editing,
    data: {
      profileName: existing?.profileName || '',
      gender: existing?.gender || '',
      relationshipStatus: existing?.relationshipStatus || '',
      age: existing?.age || '',
      height: existing?.height || '',
      address: existing?.address || '',
      hobby: existing?.hobby || '',
      photoFileId: existing?.photoFileId || '',
    },
  };

  await ctx.reply(
    editing
      ? '✏️ Profile ပြင်ဆင်မှု စတင်ပါပြီ။\n\nနာမည်ကို အရင်ပို့ပါ။'
      : '📝 Profile ဖြည့်သွင်းမှု စတင်ပါပြီ။\n\nနာမည်ကို အရင်ပို့ပါ။',
    Markup.removeKeyboard()
  );
}

async function finishProfileFlow(ctx) {
  const flow = ctx.session.profileFlow;
  const data = flow.data;

  if (!ctx.from.username) {
    await ctx.reply(
      'Telegram username မရှိသေးပါ။ Settings ထဲမှာ username သတ်မှတ်ပြီးနောက် profile ကို ပြန်ဖြည့်ပေးပါ။',
      mainMenuKeyboard()
    );
    resetProfileSession(ctx);
    return;
  }

  await User.findOneAndUpdate(
    { telegramId: Number(ctx.from.id) },
    {
      $set: {
        username: ctx.from.username || '',
        tgFirstName: ctx.from.first_name || '',
        tgLastName: ctx.from.last_name || '',
        profileName: data.profileName,
        gender: data.gender,
        relationshipStatus: data.relationshipStatus,
        age: Number(data.age),
        height: data.height,
        address: data.address,
        hobby: data.hobby,
        photoFileId: data.photoFileId,
        isProfileComplete: true,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  resetProfileSession(ctx);
  await ctx.reply('✅ သင့် Profile ကို အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။', mainMenuKeyboard());
  await showMyProfile(ctx);
}

function registerProfileCommands(bot) {
  bot.hears('📝 Profile ဖြည့်ရန်', async (ctx) => startProfileFlow(ctx, false));
  bot.hears('✏️ Profile ပြင်ရန်', async (ctx) => startProfileFlow(ctx, true));
  bot.hears('👤 ကျွန်ုပ်၏ Profile', showMyProfile);

  bot.action('edit:profile', async (ctx) => {
    await ctx.answerCbQuery();
    await startProfileFlow(ctx, true);
  });

  bot.action('toggle:hide', async (ctx) => {
    await ctx.answerCbQuery();
    const me = await getProfileByTelegramId(ctx.from.id);
    if (!me) return;
    me.isHidden = !me.isHidden;
    me.updatedAt = new Date();
    await me.save();
    await ctx.reply(
      me.isHidden ? '🙈 သင့် profile ကို ဖျောက်ထားလိုက်ပါပြီ။' : '👁 သင့် profile ကို ပြန်ပြလိုက်ပါပြီ။',
      mainMenuKeyboard()
    );
  });

  bot.on('text', async (ctx, next) => {
    const flow = ctx.session.profileFlow;
    if (!flow?.active) return next();
    if (!(await requirePrivateChat(ctx))) return;

    const text = String(ctx.message.text || '').trim();

    if (flow.step === 'name') {
      if (text.length < 2 || text.length > 40) {
        await ctx.reply('နာမည်ကို စာလုံး 2 လုံးမှ 40 လုံးအတွင်း ပို့ပေးပါ။');
        return;
      }
      flow.data.profileName = safeTextLength(text, 40);
      flow.step = 'gender';
      await ctx.reply('ကျား / မ ရွေးပေးပါ။', Markup.keyboard([['ကျား', 'မ']]).oneTime().resize());
      return;
    }

    if (flow.step === 'gender') {
      if (text !== 'ကျား' && text !== 'မ') {
        await ctx.reply('ကျား သို့မဟုတ် မ ကိုသာ ရွေးပေးပါ။', Markup.keyboard([['ကျား', 'မ']]).oneTime().resize());
        return;
      }
      flow.data.gender = text === 'ကျား' ? 'male' : 'female';
      flow.step = 'relationshipStatus';
      await ctx.reply(
        'လက်ရှိအခြေအနေကို ရွေးပေးပါ။',
        Markup.keyboard([
          ['in relationship', 'single'],
          ['ကြေကွဲလူငယ်', 'စော်မရှိ'],
          ['ဘဲမရှိ', 'လင်ရှိတယ်'],
          ['မယားရှိတယ်'],
        ]).oneTime().resize()
      );
      return;
    }

    if (flow.step === 'relationshipStatus') {
      if (!ALLOWED_STATUSES.includes(text)) {
        await ctx.reply(
          'အောက်ကထဲက တစ်ခုကိုပဲ ရွေးပေးပါ။',
          Markup.keyboard([
            ['in relationship', 'single'],
            ['ကြေကွဲလူငယ်', 'စော်မရှိ'],
            ['ဘဲမရှိ', 'လင်ရှိတယ်'],
            ['မယားရှိတယ်'],
          ]).oneTime().resize()
        );
        return;
      }
      flow.data.relationshipStatus = text;
      flow.step = 'age';
      await ctx.reply('အသက်ကို ပို့ပေးပါ။ (12 မှ 40 အတွင်း)', Markup.removeKeyboard());
      return;
    }

    if (flow.step === 'age') {
      const age = Number(text);
      if (!Number.isFinite(age) || age < 12 || age > 40) {
        await ctx.reply('အသက်ကို 12 မှ 40 အတွင်း ဂဏန်းဖြင့် ပို့ပေးပါ။');
        return;
      }
      flow.data.age = age;
      flow.step = 'height';
      await ctx.reply('အရပ်အမြင့်ကို ပို့ပေးပါ။ ဥပမာ - 5\'6" သို့မဟုတ် 168 cm');
      return;
    }

    if (flow.step === 'height') {
      if (text.length < 2 || text.length > 20) {
        await ctx.reply('အရပ်အမြင့်ကို မှန်ကန်စွာ ပို့ပေးပါ။ ဥပမာ - 5\'6" သို့မဟုတ် 168 cm');
        return;
      }
      flow.data.height = safeTextLength(text, 20);
      flow.step = 'address';
      await ctx.reply('နေရပ်လိပ်စာကို ပို့ပေးပါ။ (ဥပမာ - ရန်ကုန် / မန္တလေး / Bangkok)');
      return;
    }

    if (flow.step === 'address') {
      if (text.length < 2 || text.length > 100) {
        await ctx.reply('နေရပ်လိပ်စာကို စာလုံး 2 လုံးမှ 100 လုံးအတွင်း ပို့ပေးပါ။');
        return;
      }
      flow.data.address = safeTextLength(text, 100);
      flow.step = 'hobby';
      await ctx.reply('သင့်ဝါသနာကို ပို့ပေးပါ။ (အများဆုံး စာလုံး 200 လုံး)');
      return;
    }

    if (flow.step === 'hobby') {
      if (text.length < 2 || text.length > 200) {
        await ctx.reply('ဝါသနာကို စာလုံး 2 လုံးမှ 200 လုံးအတွင်း ပို့ပေးပါ။');
        return;
      }
      flow.data.hobby = safeTextLength(text, 200);
      flow.step = 'photo';
      await ctx.reply('နောက်ဆုံးအဆင့်အနေနဲ့ သင့်ဓာတ်ပုံတစ်ပုံ ပို့ပေးပါ။', Markup.removeKeyboard());
      return;
    }

    return next();
  });

  bot.on('photo', async (ctx, next) => {
    const flow = ctx.session.profileFlow;
    if (!flow?.active || flow.step !== 'photo') return next();
    if (!(await requirePrivateChat(ctx))) return;

    const photos = ctx.message.photo || [];
    const best = photos[photos.length - 1];
    if (!best?.file_id) {
      await ctx.reply('ဓာတ်ပုံတစ်ပုံ ထပ်ပို့ပေးပါ။');
      return;
    }

    flow.data.photoFileId = best.file_id;
    await finishProfileFlow(ctx);
  });

  bot.on('message', async (ctx, next) => {
    const flow = ctx.session.profileFlow;
    if (flow?.active && flow.step === 'photo') {
      await ctx.reply('ဒီအဆင့်မှာ ဓာတ်ပုံပဲ ပို့ပေးရပါမယ်။');
      return;
    }
    return next();
  });
}

module.exports = {
  registerProfileCommands,
  profileSessionMiddleware,
  resetProfileSession,
  ensureSessionDefaults,
  getProfileByTelegramId,
  getBrowseList,
  showGenderList,
  showMyProfile,
  startProfileFlow,
  finishProfileFlow,
};
