require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Telegraf, Markup, session } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const WEBHOOK_URL = String(process.env.WEBHOOK_URL || '').trim();
const PORT = parseInt(process.env.PORT || '10000', 10);
const ADMIN_IDS = String(process.env.ADMIN_ID || process.env.ADMIN_IDS || '')
  .split(',')
  .map((v) => Number(String(v).trim()))
  .filter((v) => Number.isFinite(v) && v > 0);

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN in .env');
if (!MONGODB_URI) throw new Error('Missing MONGODB_URI in .env');
if (!WEBHOOK_URL) throw new Error('Missing WEBHOOK_URL in .env');
if (!/^https:\/\//i.test(WEBHOOK_URL) || WEBHOOK_URL.includes('/webhook')) {
  throw new Error('WEBHOOK_URL must be base https URL only, example: https://your-app.onrender.com');
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

mongoose.set('strictQuery', true);

const ALLOWED_STATUSES = [
  'in relationship',
  'single',
  'ကြေကွဲလူငယ်',
  'စော်မရှိ',
  'ဘဲမရှိ',
  'လင်ရှိတယ်',
  'မယားရှိတယ်',
];

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

const User = mongoose.model('User', userSchema);
const Reaction = mongoose.model('Reaction', reactionSchema);
const Report = mongoose.model('Report', reportSchema);

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isAdmin(id) {
  return ADMIN_IDS.includes(Number(id));
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['📝 Profile ဖြည့်ရန်', '👤 ကျွန်ုပ်၏ Profile'],
    ['👧 Girls List', '👦 Boys List'],
    ['✏️ Profile ပြင်ရန်', '🎲 ကျပန်း Profile ကြည့်ရန်'],
    ['ℹ️ အကူအညီ'],
  ]).resize();
}

function profileOpenUrl(user) {
  if (user.username) return `https://t.me/${user.username}`;
  return `tg://user?id=${user.telegramId}`;
}

function genderLabel(value) {
  if (value === 'male') return 'ကျား';
  if (value === 'female') return 'မ';
  return '-';
}

function reactionEmoji(type) {
  if (type === 'like') return '👍';
  if (type === 'love') return '❤';
  if (type === 'laugh') return '🤣';
  return '•';
}

function safeTextLength(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

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
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
}

function buildProfileCaption(user, index, total) {
  return [
    '💘 <b>Relationship Profile</b>',
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
    '',
    `📄 <b>${total > 0 ? index + 1 : 0}/${total}</b>`,
  ].join('\n');
}

function buildProfileButtons(user, gender, index, total, isAdminView = false) {
  const rows = [
    [
      Markup.button.callback(`👍 ${user.reactions?.like || 0}`, `rx:like:${user.telegramId}:${gender}:${index}`),
      Markup.button.callback(`❤ ${user.reactions?.love || 0}`, `rx:love:${user.telegramId}:${gender}:${index}`),
      Markup.button.callback(`🤣 ${user.reactions?.laugh || 0}`, `rx:laugh:${user.telegramId}:${gender}:${index}`),
    ],
    [Markup.button.url('👤 Telegram Account ဖွင့်ရန်', profileOpenUrl(user))],
    [Markup.button.callback('🚨 Report', `report:${user.telegramId}:${gender}:${index}`)],
    [
      Markup.button.callback('⬅️ Back', `nav:${gender}:${Math.max(index - 1, 0)}`),
      Markup.button.callback('➡️ Next', `nav:${gender}:${Math.min(index + 1, Math.max(total - 1, 0))}`),
    ],
    [Markup.button.callback('🏠 Main Menu', 'main:menu')],
  ];

  if (isAdminView) {
    rows.splice(3, 0, [
      Markup.button.callback('🚫 Ban', `adminban:${user.telegramId}`),
      Markup.button.callback('🗑 Delete', `admindel:${user.telegramId}`),
    ]);
  }

  return Markup.inlineKeyboard(rows);
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
  if (index < 0) index = 0;
  if (index >= list.length) index = list.length - 1;

  await sendOrEditProfileCard(ctx, list[index], gender, index, list.length, { isAdminView });
}

async function showMyProfile(ctx) {
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

async function sendHelp(ctx) {
  await ctx.reply(
    [
      'ℹ️ <b>အကူအညီ</b>',
      '',
      '• 📝 Profile ဖြည့်ရန် - သင့် profile အသစ်ပြုလုပ်ရန်',
      '• 👧 Girls List / 👦 Boys List - တခြား user profile များကြည့်ရန်',
      '• 👤 ကျွန်ုပ်၏ Profile - ကိုယ့် profile ကြည့်ရန်',
      '• ✏️ Profile ပြင်ရန် - ကိုယ့် profile ပြင်ဆင်ရန်',
      '• 🎲 ကျပန်း Profile ကြည့်ရန် - random profile ကြည့်ရန်',
      '',
      'Admin Commands:',
      '• /admin - Admin panel ဖွင့်ရန်',
      '• /ban <telegramId>',
      '• /unban <telegramId>',
      '• /deleteprofile <telegramId>',
      '• /broadcast <message>',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard().reply_markup,
    }
  );
}

bot.use(session());

bot.use(async (ctx, next) => {
  ensureSessionDefaults(ctx);

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
});

bot.start(async (ctx) => {
  await ctx.reply(
    '💘 Relationship Bot မှ ကြိုဆိုပါသည်။\n\nသင့် profile ကို ဖြည့်ပြီး တခြား user များ၏ profile ကို ကြည့်ရှုနိုင်ပါသည်။',
    mainMenuKeyboard()
  );
});

bot.command('help', sendHelp);
bot.hears('ℹ️ အကူအညီ', sendHelp);

bot.hears('📝 Profile ဖြည့်ရန်', async (ctx) => startProfileFlow(ctx, false));
bot.hears('✏️ Profile ပြင်ရန်', async (ctx) => startProfileFlow(ctx, true));

bot.hears('👤 ကျွန်ုပ်၏ Profile', showMyProfile);

bot.hears('👧 Girls List', async (ctx) => {
  const me = await getProfileByTelegramId(ctx.from.id);
  if (!me || !me.isProfileComplete) {
    await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
    return;
  }
  await showGenderList(ctx, 'female', 0);
});

bot.hears('👦 Boys List', async (ctx) => {
  const me = await getProfileByTelegramId(ctx.from.id);
  if (!me || !me.isProfileComplete) {
    await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
    return;
  }
  await showGenderList(ctx, 'male', 0);
});

bot.hears('🎲 ကျပန်း Profile ကြည့်ရန်', async (ctx) => {
  const me = await getProfileByTelegramId(ctx.from.id);
  if (!me || !me.isProfileComplete) {
    await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
    return;
  }

  const genders = ['female', 'male'];
  const gender = genders[Math.floor(Math.random() * genders.length)];
  const list = await getBrowseList(gender, ctx.from.id);
  if (!list.length) {
    await ctx.reply('ကြည့်ရှုရန် profile မရှိသေးပါ။', mainMenuKeyboard());
    return;
  }
  const index = Math.floor(Math.random() * list.length);
  await sendOrEditProfileCard(ctx, list[index], gender, index, list.length);
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('ဒီ command ကို admin များသာ အသုံးပြုနိုင်ပါသည်။');
    return;
  }

  await ctx.reply('🛠 <b>Admin Panel</b>', {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('📊 User Count', 'admin:count')],
      [Markup.button.callback('🚨 Reported Profiles', 'admin:reports:0')],
      [Markup.button.callback('📢 Broadcast Guide', 'admin:broadcast:help')],
    ]).reply_markup,
  });
});

bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const parts = ctx.message.text.split(/\s+/);
  const targetId = Number(parts[1]);
  if (!Number.isFinite(targetId)) {
    await ctx.reply('အသုံးပြုပုံ - /ban <telegramId>');
    return;
  }
  await User.findOneAndUpdate({ telegramId: targetId }, { $set: { isBanned: true, updatedAt: new Date() } });
  await ctx.reply(`🚫 User ကို ban လုပ်ပြီးပါပြီ - ${targetId}`);
});

bot.command('unban', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const parts = ctx.message.text.split(/\s+/);
  const targetId = Number(parts[1]);
  if (!Number.isFinite(targetId)) {
    await ctx.reply('အသုံးပြုပုံ - /unban <telegramId>');
    return;
  }
  await User.findOneAndUpdate({ telegramId: targetId }, { $set: { isBanned: false, updatedAt: new Date() } });
  await ctx.reply(`✅ User ကို unban လုပ်ပြီးပါပြီ - ${targetId}`);
});

bot.command('deleteprofile', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const parts = ctx.message.text.split(/\s+/);
  const targetId = Number(parts[1]);
  if (!Number.isFinite(targetId)) {
    await ctx.reply('အသုံးပြုပုံ - /deleteprofile <telegramId>');
    return;
  }

  await Reaction.deleteMany({ $or: [{ fromUserId: targetId }, { toUserId: targetId }] });
  await Report.deleteMany({ $or: [{ reporterId: targetId }, { targetUserId: targetId }] });
  await User.deleteOne({ telegramId: targetId });
  await ctx.reply(`🗑 Profile ကို ဖျက်ပြီးပါပြီ - ${targetId}`);
});

bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const text = ctx.message.text.replace(/^\/broadcast\s*/i, '').trim();
  if (!text) {
    await ctx.reply('အသုံးပြုပုံ - /broadcast your message');
    return;
  }

  const users = await User.find({ isBanned: false }).lean();
  let ok = 0;
  let fail = 0;

  for (const u of users) {
    try {
      await bot.telegram.sendMessage(u.telegramId, `📢 Broadcast\n\n${text}`);
      ok += 1;
    } catch (_) {
      fail += 1;
    }
  }

  await ctx.reply(`Broadcast ပြီးပါပြီ။\n✅ Success: ${ok}\n❌ Failed: ${fail}`);
});

bot.action('main:menu', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await ctx.deleteMessage();
  } catch (_) {}
  await ctx.reply('🏠 Main Menu', mainMenuKeyboard());
});

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

bot.action(/^nav:(male|female):(\d+)$/, async (ctx) => {
  const [, gender, index] = ctx.match;
  await ctx.answerCbQuery();
  await showGenderList(ctx, gender, Number(index));
});

bot.action(/^rx:(like|love|laugh):(\d+):(male|female):(\d+)$/, async (ctx) => {
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

  const existing = await Reaction.findOne({ fromUserId: fromId, toUserId: targetId });
  let notifyLove = false;
  let message = '';

  if (!existing) {
    await Reaction.create({ fromUserId: fromId, toUserId: targetId, type, createdAt: new Date(), updatedAt: new Date() });
    targetUser.reactions[type] += 1;
    notifyLove = type === 'love';
    message = `${reactionEmoji(type)} reaction ပေးပြီးပါပြီ။`;
  } else if (existing.type === type) {
    await Reaction.deleteOne({ _id: existing._id });
    targetUser.reactions[type] = Math.max(0, (targetUser.reactions[type] || 0) - 1);
    message = `${reactionEmoji(type)} reaction ကို ပြန်ဖျက်ပြီးပါပြီ။`;
  } else {
    targetUser.reactions[existing.type] = Math.max(0, (targetUser.reactions[existing.type] || 0) - 1);
    existing.type = type;
    existing.updatedAt = new Date();
    await existing.save();
    targetUser.reactions[type] += 1;
    notifyLove = type === 'love';
    message = `${reactionEmoji(type)} reaction ကို ပြောင်းလဲပြီးပါပြီ။`;
  }

  targetUser.updatedAt = new Date();
  await targetUser.save();

  if (notifyLove) {
    try {
      await bot.telegram.sendMessage(
        targetUser.telegramId,
        `❤ သင့် profile တွင် ❤ reaction အသစ်တစ်ခု ရရှိထားပါသည်။\nစုစုပေါင်း ❤ : ${targetUser.reactions.love}`
      );
    } catch (_) {}
  }

  await ctx.answerCbQuery(message);
  await showGenderList(ctx, gender, index);
});

bot.action(/^report:(\d+):(male|female):(\d+)$/, async (ctx) => {
  const [, targetIdRaw, gender, indexRaw] = ctx.match;
  const targetId = Number(targetIdRaw);
  const index = Number(indexRaw);
  const fromId = Number(ctx.from.id);

  if (fromId === targetId) {
    await ctx.answerCbQuery('ကိုယ့် profile ကို report မလုပ်နိုင်ပါ။', { show_alert: true });
    return;
  }

  await Report.findOneAndUpdate(
    { reporterId: fromId, targetUserId: targetId },
    {
      $set: { reason: 'အတုအယောင် profile', status: 'pending', updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true }
  );

  await ctx.answerCbQuery('🚨 Report ပို့ပြီးပါပြီ။');
  await showGenderList(ctx, gender, index);
});

bot.action('admin:count', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCbQuery();

  const [total, male, female, completed, banned, pendingReports] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ gender: 'male', isProfileComplete: true }),
    User.countDocuments({ gender: 'female', isProfileComplete: true }),
    User.countDocuments({ isProfileComplete: true }),
    User.countDocuments({ isBanned: true }),
    Report.countDocuments({ status: 'pending' }),
  ]);

  await ctx.reply(
    [
      '📊 Admin Stats',
      `စုစုပေါင်း Users: ${total}`,
      `Profile ဖြည့်ပြီးသူ: ${completed}`,
      `Boys: ${male}`,
      `Girls: ${female}`,
      `Banned Users: ${banned}`,
      `Pending Reports: ${pendingReports}`,
    ].join('\n')
  );
});

bot.action('admin:broadcast:help', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCbQuery();
  await ctx.reply('📢 Broadcast အသုံးပြုပုံ\n/broadcast your message here');
});

bot.action(/^admin:reports:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const index = Number(ctx.match[1]) || 0;
  const reports = await Report.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();

  if (!reports.length) {
    await ctx.answerCbQuery('Pending reports မရှိသေးပါ။');
    return;
  }

  const currentIndex = Math.max(0, Math.min(index, reports.length - 1));
  const report = reports[currentIndex];
  const target = await User.findOne({ telegramId: report.targetUserId }).lean();
  const reporter = await User.findOne({ telegramId: report.reporterId }).lean();

  const text = [
    '🚨 <b>Reported Profile</b>',
    '',
    `Report: <b>${currentIndex + 1}/${reports.length}</b>`,
    `Target ID: <code>${report.targetUserId}</code>`,
    `Reporter ID: <code>${report.reporterId}</code>`,
    `Target Name: ${escapeHtml(target?.profileName || 'Deleted User')}`,
    `Reporter Name: ${escapeHtml(reporter?.profileName || reporter?.tgFirstName || 'Unknown')}`,
    `Reason: ${escapeHtml(report.reason || '-')}`,
    `Status: ${escapeHtml(report.status)}`,
  ].join('\n');

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('⬅️ Prev', `admin:reports:${Math.max(currentIndex - 1, 0)}`),
      Markup.button.callback('➡️ Next', `admin:reports:${Math.min(currentIndex + 1, reports.length - 1)}`),
    ],
    [
      Markup.button.callback('🚫 Ban Target', `admin:banreport:${report.targetUserId}`),
      Markup.button.callback('🗑 Delete Target', `admin:delreport:${report.targetUserId}`),
    ],
    [Markup.button.callback('✅ Ignore Report', `admin:ignorereport:${report._id}`)],
  ]);

  await ctx.answerCbQuery();
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
  } catch (_) {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
  }
});

bot.action(/^admin:ignorereport:([a-f0-9]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const reportId = ctx.match[1];
  await Report.findByIdAndUpdate(reportId, { $set: { status: 'ignored', updatedAt: new Date() } });
  await ctx.answerCbQuery('Report ignored');
  await ctx.reply('✅ Report ကို ignore လုပ်ပြီးပါပြီ။');
});

bot.action(/^admin:banreport:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const targetId = Number(ctx.match[1]);
  await User.findOneAndUpdate({ telegramId: targetId }, { $set: { isBanned: true, updatedAt: new Date() } });
  await Report.updateMany({ targetUserId: targetId, status: 'pending' }, { $set: { status: 'resolved', updatedAt: new Date() } });
  await ctx.answerCbQuery('User banned');
  await ctx.reply(`🚫 User ကို ban လုပ်ပြီးပါပြီ - ${targetId}`);
});

bot.action(/^admin:delreport:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const targetId = Number(ctx.match[1]);
  await Reaction.deleteMany({ $or: [{ fromUserId: targetId }, { toUserId: targetId }] });
  await Report.deleteMany({ $or: [{ reporterId: targetId }, { targetUserId: targetId }] });
  await User.deleteOne({ telegramId: targetId });
  await ctx.answerCbQuery('Profile deleted');
  await ctx.reply(`🗑 Profile ကို ဖျက်ပြီးပါပြီ - ${targetId}`);
});

bot.action(/^adminban:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const targetId = Number(ctx.match[1]);
  await User.findOneAndUpdate({ telegramId: targetId }, { $set: { isBanned: true, updatedAt: new Date() } });
  await ctx.answerCbQuery('User banned');
});

bot.action(/^admindel:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const targetId = Number(ctx.match[1]);
  await Reaction.deleteMany({ $or: [{ fromUserId: targetId }, { toUserId: targetId }] });
  await Report.deleteMany({ $or: [{ reporterId: targetId }, { targetUserId: targetId }] });
  await User.deleteOne({ telegramId: targetId });
  await ctx.answerCbQuery('Profile deleted');
});

bot.on('text', async (ctx, next) => {
  const flow = ctx.session.profileFlow;
  if (!flow?.active) return next();

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
    await ctx.reply('အသက်ကို ပို့ပေးပါ။ (18 မှ 40 အတွင်း)', Markup.removeKeyboard());
    return;
  }

  if (flow.step === 'age') {
    const age = Number(text);
    if (!Number.isFinite(age) || age < 18 || age > 40) {
      await ctx.reply('အသက်ကို 18 မှ 40 အတွင်း ဂဏန်းဖြင့် ပို့ပေးပါ။');
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

bot.catch(async (err, ctx) => {
  console.error('BOT_ERROR:', err);
  try {
    await ctx.reply('❌ Error တစ်ခု ဖြစ်သွားပါတယ်။ ခဏနေရင် ပြန်စမ်းကြည့်ပါ။', mainMenuKeyboard());
  } catch (_) {}
});

app.get('/', (_req, res) => {
  res.status(200).send('Relationship bot is running');
});

app.use(bot.webhookCallback('/webhook'));

(async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    await bot.telegram.setWebhook(`${WEBHOOK_URL.replace(/\/$/, '')}/webhook`);

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log('Webhook bot started');
    });
  } catch (error) {
    console.error('STARTUP_ERROR:', error);
    process.exit(1);
  }
})();
