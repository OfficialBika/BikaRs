const { Markup } = require('telegraf');
const User = require('../models/User');
const Reaction = require('../models/Reaction');
const Report = require('../models/Report');
const { ALLOWED_STATUSES, MAX_PROFILE_MEDIA } = require('../config/env');
const { requirePrivateChat } = require('../middlewares/privateOnly');
const { escapeHtml, safeTextLength } = require('../utils/escapeHtml');
const {
  BUTTON_STYLE,
  callbackButton,
  inlineKeyboard,
  replyButton,
  replyKeyboard,
  mainMenuKeyboard,
  genderLabel,
  buildProfileCaption,
  buildPremiumProfileCaption,
  buildProfileButtons,
  buildDirectProfileButtons,
  reactionEmoji,
} = require('../utils/keyboards');
const {
  extractMediaFromMessage,
  backupMediaToChannel,
  buildMediaMetadata,
  normalizeProfileMedia,
  sendProfileCard,
  mediaDoneKeyboard,
  sendNewUserAlertToSupportChannel,
} = require('../utils/media');
const { ensureProfileId, isValidProfileId } = require('../utils/profileIds');
const { attachPremiumToUser, attachPremiumToUsers } = require('../utils/premium');

function resetProfileSession(ctx) {
  ctx.session.profileFlow = {
    active: false,
    step: '',
    data: {},
    editing: false,
  };
}

function resetMediaSession(ctx) {
  ctx.session.mediaFlow = {
    active: false,
    mode: '',
    pendingMedia: [],
  };
}

function resetMediaUiSession(ctx) {
  ctx.session.mediaUi = {
    messageIds: [],
  };
}

function resetProfileUiSession(ctx) {
  ctx.session.profileUi = {
    messageIds: [],
  };
}

function ensureSessionDefaults(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.profileFlow) resetProfileSession(ctx);
  if (!ctx.session.mediaFlow) resetMediaSession(ctx);
  if (!ctx.session.mediaUi) resetMediaUiSession(ctx);
  if (!ctx.session.profileUi) resetProfileUiSession(ctx);
}

function normalizeMessageIds(messagesOrMessage) {
  const items = Array.isArray(messagesOrMessage) ? messagesOrMessage : [messagesOrMessage];
  return items
    .map((message) => Number(message?.message_id || message))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function rememberMediaUiMessages(ctx, messagesOrMessage) {
  ensureSessionDefaults(ctx);
  const ids = normalizeMessageIds(messagesOrMessage);
  const current = Array.isArray(ctx.session.mediaUi.messageIds) ? ctx.session.mediaUi.messageIds : [];
  ctx.session.mediaUi.messageIds = [...new Set([...current, ...ids])].slice(-30);
}

function rememberProfileUiMessages(ctx, messagesOrMessage) {
  ensureSessionDefaults(ctx);
  const ids = normalizeMessageIds(messagesOrMessage);
  ctx.session.profileUi.messageIds = [...new Set(ids)].slice(-30);
}

async function safeDeleteMessage(ctx, messageId) {
  const id = Number(messageId);
  if (!Number.isFinite(id) || id <= 0 || !ctx.chat?.id) return;
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, id);
  } catch (_) {}
}

function isGroupChat(ctx) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

async function clearGroupReplyKeyboard(ctx) {
  if (!isGroupChat(ctx)) return;
  try {
    const msg = await ctx.reply('⌛', Markup.removeKeyboard());
    setTimeout(() => {
      ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
    }, 800).unref?.();
  } catch (_) {}
}

function contextMenuKeyboard(ctx) {
  return isGroupChat(ctx) ? Markup.removeKeyboard() : mainMenuKeyboard();
}

async function cleanupMessageIds(ctx, ids = []) {
  const uniqueIds = [...new Set(ids.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  for (const id of uniqueIds) {
    await safeDeleteMessage(ctx, id);
  }
}

async function cleanupMediaUi(ctx, options = {}) {
  ensureSessionDefaults(ctx);
  const ids = Array.isArray(ctx.session.mediaUi.messageIds) ? [...ctx.session.mediaUi.messageIds] : [];
  if (options.includeCurrentCallback && ctx.callbackQuery?.message?.message_id) {
    ids.push(ctx.callbackQuery.message.message_id);
  }
  await cleanupMessageIds(ctx, ids);
  resetMediaUiSession(ctx);
}

async function cleanupProfileUi(ctx, options = {}) {
  ensureSessionDefaults(ctx);
  const ids = Array.isArray(ctx.session.profileUi.messageIds) ? [...ctx.session.profileUi.messageIds] : [];
  if (options.includeCurrentCallback && ctx.callbackQuery?.message?.message_id) {
    ids.push(ctx.callbackQuery.message.message_id);
  }
  await cleanupMessageIds(ctx, ids);
  resetProfileUiSession(ctx);
}

async function replyAndRememberMediaUi(ctx, text, extra = {}) {
  const msg = await ctx.reply(text, extra);
  rememberMediaUiMessages(ctx, msg);
  return msg;
}

function profileSessionMiddleware(ctx, next) {
  ensureSessionDefaults(ctx);
  return next();
}

async function getProfileByTelegramId(telegramId) {
  return User.findOne({ telegramId: Number(telegramId) });
}

function isPremiumActiveUser(user = {}) {
  return Boolean(user?.premium?.isActive);
}

function profileSortValue(user = {}) {
  const profileId = Number(user.profileId || 0);
  if (Number.isFinite(profileId) && profileId > 0) return profileId;

  const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;
  if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;

  return Number(user.telegramId || 0);
}

function sortBrowseProfiles(users = []) {
  return [...users].sort((a, b) => {
    const premiumDiff = Number(isPremiumActiveUser(b)) - Number(isPremiumActiveUser(a));
    if (premiumDiff !== 0) return premiumDiff;

    const idDiff = profileSortValue(a) - profileSortValue(b);
    if (idDiff !== 0) return idDiff;

    return Number(a.telegramId || 0) - Number(b.telegramId || 0);
  });
}

async function getBrowseList(gender, viewerId) {
  const users = await User.find({
    gender,
    isProfileComplete: true,
    isBanned: false,
    isHidden: false,
    telegramId: { $ne: Number(viewerId) },
  })
    .sort({ profileId: 1, createdAt: 1, telegramId: 1 })
    .lean();

  const usersWithPremium = await attachPremiumToUsers(users);
  return sortBrowseProfiles(usersWithPremium);
}

async function sendOrEditProfileCard(ctx, user, gender, index, total, options = {}) {
  await cleanupProfileUi(ctx, { includeCurrentCallback: true });
  const profileUser = user?.premium ? user : await attachPremiumToUser(user);
  const caption = buildProfileCaption(profileUser, index, total);
  const keyboard = buildProfileButtons(profileUser, gender, index, total, options.isAdminView);
  const sentMessages = await sendProfileCard(ctx, profileUser, caption, keyboard, {
    album: true,
    premiumRich: true,
    richTitle: 'PREMIUM CUPID PROFILE',
    includePagination: true,
    index,
    total,
  });
  rememberProfileUiMessages(ctx, sentMessages);
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
          reply_markup: inlineKeyboard([
            [callbackButton('🏠 Main Menu', 'main:menu', BUTTON_STYLE.PRIMARY)],
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

function buildMyProfileCaption(user) {
  const mediaCount = normalizeProfileMedia(user).length;
  const isPremium = Boolean(user.premium?.isActive);
  if (isPremium) {
    return buildPremiumProfileCaption(user, {
      title: 'ကျွန်ုပ်၏ PREMIUM PROFILE',
      mediaCount,
      includePagination: false,
    });
  }

  return [
    '👤 <b>ကျွန်ုပ်၏ Profile</b>',
    `🆔 <b>Profile ID:</b> <code>${escapeHtml(user.profileId || '-')}</code>`,
    `👤 <b>နာမည်:</b> ${escapeHtml(user.profileName || '-')}`,
    `⚧ <b>လိင်:</b> ${escapeHtml(genderLabel(user.gender))}`,
    `💞 <b>လက်ရှိအခြေအနေ:</b> ${escapeHtml(user.relationshipStatus || '-')}`,
    `🎂 <b>အသက်:</b> ${escapeHtml(user.age || '-')}`,
    `📏 <b>အရပ်အမြင့်:</b> ${escapeHtml(user.height || '-')}`,
    `📍 <b>နေရပ်လိပ်စာ:</b> ${escapeHtml(user.address || '-')}`,
    `🎯 <b>ဝါသနာ:</b> ${escapeHtml(user.hobby || '-')}`,
    `🆔 <b>Username:</b> ${user.username ? `@${escapeHtml(user.username)}` : 'မရှိသေးပါ'}`,
    `🖼 <b>Media:</b> ${mediaCount}/${MAX_PROFILE_MEDIA}`,
    '',
    `👍 ${user.reactions?.like || 0}   ❤ ${user.reactions?.love || 0}   🤣 ${user.reactions?.laugh || 0}`,
  ].join('\n');
}

function myProfileKeyboard(user) {
  return inlineKeyboard([
    [callbackButton('✏️ Profile ပြင်ရန်', 'edit:profile', BUTTON_STYLE.PRIMARY)],
    [callbackButton('🖼 ပုံထည့်/ပြင်မယ်', 'media:manage', BUTTON_STYLE.SUCCESS)],
    [callbackButton(user.isHidden ? '👁 Profile ပြန်ပြရန်' : '🙈 Profile ဖျောက်ရန်', 'toggle:hide', user.isHidden ? BUTTON_STYLE.SUCCESS : BUTTON_STYLE.DANGER)],
  ]);
}

async function showMyProfile(ctx) {
  if (!(await requirePrivateChat(ctx))) return;

  const user = await getProfileByTelegramId(ctx.from.id);
  if (!user || !user.isProfileComplete) {
    await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
    return;
  }

  const profileUser = await attachPremiumToUser(user);
  await cleanupProfileUi(ctx);
  const sentMessages = await sendProfileCard(ctx, profileUser, buildMyProfileCaption(profileUser), myProfileKeyboard(profileUser), {
    album: true,
    premiumRich: true,
    richTitle: 'ကျွန်ုပ်၏ PREMIUM PROFILE',
    includePagination: false,
  });
  rememberProfileUiMessages(ctx, sentMessages);
}


async function showProfileByProfileId(ctx, profileId) {
  await clearGroupReplyKeyboard(ctx);

  const id = Number(profileId);
  if (!isValidProfileId(id)) {
    await ctx.reply('အသုံးပြုပုံ - /check 1\nဥပမာ - /check 1', contextMenuKeyboard(ctx));
    return;
  }

  const user = await User.findOne({
    profileId: id,
    isProfileComplete: true,
    isBanned: false,
  }).lean();

  if (!user) {
    await ctx.reply(`Profile ID ${id} ကို မတွေ့ပါ။`, contextMenuKeyboard(ctx));
    return;
  }

  const profileUser = await attachPremiumToUser(user);
  await cleanupProfileUi(ctx, { includeCurrentCallback: true });
  const sentMessages = await sendProfileCard(ctx, profileUser, buildProfileCaption(profileUser, 0, 1), buildDirectProfileButtons(profileUser), {
    album: true,
    premiumRich: true,
    richTitle: 'PREMIUM CUPID PROFILE',
    includePagination: true,
    index: 0,
    total: 1,
  });
  rememberProfileUiMessages(ctx, sentMessages);
}

async function applyDirectProfileReaction(ctx, type, targetId) {
  const fromId = Number(ctx.from.id);
  const targetTelegramId = Number(targetId);

  if (fromId === targetTelegramId) {
    await ctx.answerCbQuery('ကိုယ့် profile ကို reaction မပေးနိုင်ပါ။', { show_alert: true });
    return null;
  }

  const targetUser = await User.findOne({
    telegramId: targetTelegramId,
    isProfileComplete: true,
    isBanned: false,
  });

  if (!targetUser) {
    await ctx.answerCbQuery('Profile မတွေ့ပါ။', { show_alert: true });
    return null;
  }

  const existing = await Reaction.findOne({ fromUserId: fromId, toUserId: targetTelegramId });
  let notifyReactionType = '';
  let message = '';

  if (!existing) {
    await Reaction.create({
      fromUserId: fromId,
      toUserId: targetTelegramId,
      type,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    targetUser.reactions[type] += 1;
    notifyReactionType = type;
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
    notifyReactionType = type;
    message = `${reactionEmoji(type)} reaction ကို ပြောင်းလဲပြီးပါပြီ။`;
  }

  targetUser.updatedAt = new Date();
  await targetUser.save();

  if (notifyReactionType) {
    try {
      const emoji = reactionEmoji(notifyReactionType);
      const totalCount = targetUser.reactions[notifyReactionType] || 0;

      await ctx.telegram.sendMessage(
        targetUser.telegramId,
        `သင့် profile တွင် ${emoji} reaction အသစ်တစ်ခု ရရှိထားပါသည်။\nစုစုပေါင်း ${emoji} : ${totalCount}`
      );
    } catch (_) {}
  }

  await ctx.answerCbQuery(message);
  return targetUser;
}

async function reportDirectProfile(ctx, targetId) {
  const fromId = Number(ctx.from.id);
  const targetTelegramId = Number(targetId);

  if (fromId === targetTelegramId) {
    await ctx.answerCbQuery('ကိုယ့် profile ကို report မလုပ်နိုင်ပါ။', { show_alert: true });
    return;
  }

  const targetUser = await User.findOne({
    telegramId: targetTelegramId,
    isProfileComplete: true,
  }).lean();

  if (!targetUser) {
    await ctx.answerCbQuery('Profile မတွေ့ပါ။', { show_alert: true });
    return;
  }

  await Report.findOneAndUpdate(
    { reporterId: fromId, targetUserId: targetTelegramId },
    {
      $set: { reason: 'အတုအယောင် profile', status: 'pending', updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true }
  );

  await ctx.answerCbQuery('🚨 Report ပို့ပြီးပါပြီ။');
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
      media: [],
    },
  };
  resetMediaSession(ctx);

  await ctx.reply(
    editing
      ? '✏️ Profile ပြင်ဆင်မှု စတင်ပါပြီ။\n\nနာမည်ကို အရင်ပို့ပါ။'
      : '📝 Profile ဖြည့်သွင်းမှု စတင်ပါပြီ။\n\nနာမည်ကို အရင်ပို့ပါ။',
    Markup.removeKeyboard()
  );
}

function promptMediaUpload(ctx, textPrefix = '') {
  const text = [
    textPrefix,
    `🖼 Photo / Video ကို 1 ခုမှ ${MAX_PROFILE_MEDIA} ခုအထိ ပို့ပါ။`,
    '',
    'ပြီးရင် ✅ Done ကိုနှိပ်ပါ။',
    'Video အရှည်ကြီးတွေမပို့ဘဲ profile အတွက်သင့်တော်တဲ့ short video ပို့တာပိုကောင်းပါတယ်။',
  ].filter(Boolean).join('\n');

  return replyAndRememberMediaUi(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: mediaDoneKeyboard().reply_markup,
  });
}


async function finishProfileFlow(ctx) {
  const flow = ctx.session.profileFlow;
  const data = flow.data;
  const media = Array.isArray(data.media) ? data.media : [];

  if (!media.length) {
    await promptMediaUpload(ctx, 'အနည်းဆုံး photo/video 1 ခုလိုအပ်ပါတယ်။');
    return;
  }

  if (!ctx.from.username) {
    await ctx.reply(
      'Telegram username မရှိသေးပါ။ Settings ထဲမှာ username သတ်မှတ်ပြီးနောက် profile ကို ပြန်ဖြည့်ပေးပါ။',
      mainMenuKeyboard()
    );
    resetProfileSession(ctx);
    return;
  }

  const existingUser = await User.findOne({ telegramId: Number(ctx.from.id) }).lean();
  const wasComplete = Boolean(existingUser?.isProfileComplete);

  let savedUser = await User.findOneAndUpdate(
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
        media,
        photoFileId: media[0]?.fileId || '',
        isProfileComplete: true,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  savedUser = await ensureProfileId(savedUser);

  if (!wasComplete) {
    await sendNewUserAlertToSupportChannel(ctx, await attachPremiumToUser(savedUser));
  }

  resetProfileSession(ctx);
  resetMediaSession(ctx);
  await ctx.reply('✅ သင့် Profile ကို အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။', mainMenuKeyboard());
  await showMyProfile(ctx);
}

async function addMediaToProfileFlow(ctx, rawMedia) {
  const flow = ctx.session.profileFlow;
  const current = flow.data.media || [];

  if (current.length >= MAX_PROFILE_MEDIA) {
    await safeDeleteMessage(ctx, ctx.message?.message_id);
    await cleanupMediaUi(ctx);
    await promptMediaUpload(ctx, `အများဆုံး ${MAX_PROFILE_MEDIA} ခုထိပဲ ထည့်နိုင်ပါတယ်။ ✅ Done ကိုနှိပ်ပါ။`);
    return;
  }

  const action = flow.editing ? 'update' : 'create';
  const backup = await backupMediaToChannel(ctx, rawMedia, action);
  const meta = buildMediaMetadata(rawMedia, backup, current.length, action);
  flow.data.media = [...current, meta];

  await safeDeleteMessage(ctx, ctx.message?.message_id);
  await cleanupMediaUi(ctx);

  await promptMediaUpload(
    ctx,
    `✅ Media ${flow.data.media.length}/${MAX_PROFILE_MEDIA} သိမ်းပြီးပါပြီ။ နောက်ထပ် photo/video ပို့နိုင်ပါတယ် သို့မဟုတ် ✅ Done နှိပ်ပါ။`
  );
}


async function startMediaManage(ctx) {
  if (!(await requirePrivateChat(ctx))) return;
  await cleanupProfileUi(ctx);
  await cleanupMediaUi(ctx);

  const user = await getProfileByTelegramId(ctx.from.id);
  if (!user || !user.isProfileComplete) {
    await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
    return;
  }

  const count = normalizeProfileMedia(user).length;
  await replyAndRememberMediaUi(
    ctx,
    [
      '🖼 <b>Profile Media ထည့်/ပြင်မယ်</b>',
      '',
      `လက်ရှိ media: <b>${count}/${MAX_PROFILE_MEDIA}</b>`,
      '',
      '➕ ပုံအသစ်ထပ်ထည့်မယ် - media အဟောင်းတွေကိုမဖျက်ဘဲ ထပ်ထည့်မယ်။',
      '♻️ ပုံအစားထိုးမယ် - media အဟောင်းနေရာကို အသစ်နဲ့အစားထိုးမယ်။',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard([
        [callbackButton('➕ ပုံအသစ်ထပ်ထည့်မယ်', 'media:start:add', BUTTON_STYLE.SUCCESS)],
        [callbackButton('♻️ ပုံအစားထိုးမယ်', 'media:start:replace', BUTTON_STYLE.PRIMARY)],
        [callbackButton('❌ Cancel', 'media:cancel', BUTTON_STYLE.DANGER)],
      ]).reply_markup,
    }
  );
}


async function startMediaUpdateFlow(ctx, mode) {
  if (!(await requirePrivateChat(ctx))) return;
  const user = await getProfileByTelegramId(ctx.from.id);
  if (!user || !user.isProfileComplete) {
    await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
    return;
  }

  const existingCount = normalizeProfileMedia(user).length;
  if (mode === 'add' && existingCount >= MAX_PROFILE_MEDIA) {
    await ctx.reply(`လက်ရှိ media ${MAX_PROFILE_MEDIA}/${MAX_PROFILE_MEDIA} ဖြစ်နေပါတယ်။ ထပ်ထည့်လို့မရတော့ပါ။ အစားထိုးတာကိုသုံးပါ။`, mainMenuKeyboard());
    return;
  }

  ctx.session.mediaFlow = {
    active: true,
    mode,
    pendingMedia: [],
  };

  const prefix = mode === 'replace'
    ? '♻️ အစားထိုးမယ်။ Media အသစ်တွေကိုပို့ပါ။ Done နှိပ်ပြီးတဲ့အခါ backup channel ထဲမှာ <b>post update</b> caption နဲ့အသစ်တင်ပြီး MongoDB ကိုအသစ်နဲ့ update လုပ်ပါမယ်။'
    : `➕ ထပ်ထည့်မယ်။ နောက်ထပ် ${MAX_PROFILE_MEDIA - existingCount} ခုအထိပို့နိုင်ပါတယ်။`;

  await promptMediaUpload(ctx, prefix);
}

async function addMediaToMediaUpdateFlow(ctx, rawMedia) {
  const flow = ctx.session.mediaFlow;
  const user = await getProfileByTelegramId(ctx.from.id);
  const existing = normalizeProfileMedia(user);
  const pending = flow.pendingMedia || [];
  const maxAllowed = flow.mode === 'add' ? MAX_PROFILE_MEDIA - existing.length : MAX_PROFILE_MEDIA;

  if (pending.length >= maxAllowed) {
    await safeDeleteMessage(ctx, ctx.message?.message_id);
    await cleanupMediaUi(ctx);
    await promptMediaUpload(ctx, `အများဆုံး ${maxAllowed} ခုထိပဲ ပို့နိုင်ပါတယ်။ ✅ Done ကိုနှိပ်ပါ။`);
    return;
  }

  const action = flow.mode === 'replace' ? 'update' : 'add';
  const backup = await backupMediaToChannel(ctx, rawMedia, action);
  const meta = buildMediaMetadata(rawMedia, backup, flow.mode === 'add' ? existing.length + pending.length : pending.length, action);
  flow.pendingMedia = [...pending, meta];

  await safeDeleteMessage(ctx, ctx.message?.message_id);
  await cleanupMediaUi(ctx);

  await promptMediaUpload(
    ctx,
    `✅ Media ${flow.pendingMedia.length}/${maxAllowed} သိမ်းပြီးပါပြီ။ နောက်ထပ် photo/video ပို့နိုင်ပါတယ် သို့မဟုတ် ✅ Done နှိပ်ပါ။`
  );
}


async function finishMediaUpdateFlow(ctx) {
  const flow = ctx.session.mediaFlow;
  if (!flow?.active) return;

  const pending = Array.isArray(flow.pendingMedia) ? flow.pendingMedia : [];
  if (!pending.length) {
    await ctx.answerCbQuery('အနည်းဆုံး media 1 ခု ပို့ပါ။', { show_alert: true });
    return;
  }

  const user = await getProfileByTelegramId(ctx.from.id);
  const existing = normalizeProfileMedia(user);
  const newMedia = flow.mode === 'replace'
    ? pending.map((item, index) => ({ ...item, order: index }))
    : [...existing, ...pending].slice(0, MAX_PROFILE_MEDIA).map((item, index) => ({ ...item, order: index }));

  await User.findOneAndUpdate(
    { telegramId: Number(ctx.from.id) },
    {
      $set: {
        media: newMedia,
        photoFileId: newMedia[0]?.fileId || '',
        updatedAt: new Date(),
      },
    },
    { new: true }
  );

  await cleanupMediaUi(ctx, { includeCurrentCallback: true });
  resetMediaSession(ctx);
  await ctx.answerCbQuery('Media update ပြီးပါပြီ။').catch(() => {});
  await ctx.reply(flow.mode === 'replace' ? '♻️ Profile media ကို အသစ်နဲ့ အစားထိုးပြီးပါပြီ။' : '➕ Profile media အသစ်ထပ်ထည့်ပြီးပါပြီ။', mainMenuKeyboard());
  await showMyProfile(ctx);
}

async function cancelMediaFlows(ctx) {
  await cleanupMediaUi(ctx, { includeCurrentCallback: true });
  resetMediaSession(ctx);
  resetProfileSession(ctx);
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('❌ Cancel လုပ်ပြီးပါပြီ။', mainMenuKeyboard());
}

async function handleIncomingMedia(ctx, next) {
  ensureSessionDefaults(ctx);
  const rawMedia = extractMediaFromMessage(ctx.message);
  if (!rawMedia) return next();

  if (ctx.session.profileFlow?.active && ctx.session.profileFlow.step === 'media') {
    if (!(await requirePrivateChat(ctx))) return;
    await addMediaToProfileFlow(ctx, rawMedia);
    return;
  }

  if (ctx.session.mediaFlow?.active) {
    if (!(await requirePrivateChat(ctx))) return;
    await addMediaToMediaUpdateFlow(ctx, rawMedia);
    return;
  }

  return next();
}

function registerProfileCommands(bot) {
  bot.hears('📝 Profile ဖြည့်ရန်', async (ctx) => startProfileFlow(ctx, false));
  bot.hears('✏️ Profile ပြင်ရန်', async (ctx) => startProfileFlow(ctx, true));
  bot.hears('👤 ကျွန်ုပ်၏ Profile', showMyProfile);
  bot.hears('🖼 ပုံထည့်/ပြင်မယ်', startMediaManage);

  bot.command('check', async (ctx) => {
    const parts = String(ctx.message?.text || '').trim().split(/\s+/);
    await showProfileByProfileId(ctx, parts[1]);
  });

  bot.action(/^rxcheck:(like|love|laugh):(\d+)$/, async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;
    const [, type, targetId] = ctx.match;
    const targetUser = await applyDirectProfileReaction(ctx, type, targetId);
    if (targetUser?.profileId) {
      await showProfileByProfileId(ctx, targetUser.profileId);
    }
  });

  bot.action(/^reportcheck:(\d+)$/, async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;
    const [, targetId] = ctx.match;
    await reportDirectProfile(ctx, targetId);
  });

  bot.action('edit:profile', async (ctx) => {
    await ctx.answerCbQuery();
    await cleanupProfileUi(ctx, { includeCurrentCallback: true });
    await startProfileFlow(ctx, true);
  });

  bot.action('media:manage', async (ctx) => {
    await ctx.answerCbQuery();
    await cleanupProfileUi(ctx, { includeCurrentCallback: true });
    await startMediaManage(ctx);
  });

  bot.action(/^media:start:(add|replace)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await cleanupMediaUi(ctx, { includeCurrentCallback: true });
    await startMediaUpdateFlow(ctx, ctx.match[1]);
  });

  bot.action('media:done', async (ctx) => {
    ensureSessionDefaults(ctx);
    if (ctx.session.profileFlow?.active && ctx.session.profileFlow.step === 'media') {
      const media = Array.isArray(ctx.session.profileFlow.data?.media) ? ctx.session.profileFlow.data.media : [];
      if (!media.length) {
        await ctx.answerCbQuery('အနည်းဆုံး media 1 ခု ပို့ပါ။', { show_alert: true });
        return;
      }
      await ctx.answerCbQuery();
      await cleanupMediaUi(ctx, { includeCurrentCallback: true });
      await finishProfileFlow(ctx);
      return;
    }
    if (ctx.session.mediaFlow?.active) {
      await finishMediaUpdateFlow(ctx);
      return;
    }
    await ctx.answerCbQuery('Active media flow မရှိပါ။');
  });

  bot.action('media:cancel', cancelMediaFlows);

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

  bot.on('photo', handleIncomingMedia);
  bot.on('video', handleIncomingMedia);

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
      await ctx.reply(
        'ကျား / မ ရွေးပေးပါ။',
        replyKeyboard([[replyButton('ကျား', BUTTON_STYLE.PRIMARY), replyButton('မ', BUTTON_STYLE.PRIMARY)]], { oneTime: true })
      );
      return;
    }

    if (flow.step === 'gender') {
      if (text !== 'ကျား' && text !== 'မ') {
        await ctx.reply(
          'ကျား သို့မဟုတ် မ ကိုသာ ရွေးပေးပါ။',
          replyKeyboard([[replyButton('ကျား', BUTTON_STYLE.PRIMARY), replyButton('မ', BUTTON_STYLE.PRIMARY)]], { oneTime: true })
        );
        return;
      }
      flow.data.gender = text === 'ကျား' ? 'male' : 'female';
      flow.step = 'relationshipStatus';
      await ctx.reply(
        'လက်ရှိအခြေအနေကို ရွေးပေးပါ။',
        replyKeyboard([
          [replyButton('in relationship', BUTTON_STYLE.SUCCESS), replyButton('single', BUTTON_STYLE.PRIMARY)],
          [replyButton('ကြေကွဲလူငယ်', BUTTON_STYLE.PRIMARY), replyButton('စော်မရှိ', BUTTON_STYLE.PRIMARY)],
          [replyButton('ဘဲမရှိ', BUTTON_STYLE.PRIMARY), replyButton('လင်ရှိတယ်', BUTTON_STYLE.SUCCESS)],
          [replyButton('မယားရှိတယ်', BUTTON_STYLE.SUCCESS)],
        ], { oneTime: true })
      );
      return;
    }

    if (flow.step === 'relationshipStatus') {
      if (!ALLOWED_STATUSES.includes(text)) {
        await ctx.reply(
          'အောက်ကထဲက တစ်ခုကိုပဲ ရွေးပေးပါ။',
          replyKeyboard([
            [replyButton('in relationship', BUTTON_STYLE.SUCCESS), replyButton('single', BUTTON_STYLE.PRIMARY)],
            [replyButton('ကြေကွဲလူငယ်', BUTTON_STYLE.PRIMARY), replyButton('စော်မရှိ', BUTTON_STYLE.PRIMARY)],
            [replyButton('ဘဲမရှိ', BUTTON_STYLE.PRIMARY), replyButton('လင်ရှိတယ်', BUTTON_STYLE.SUCCESS)],
            [replyButton('မယားရှိတယ်', BUTTON_STYLE.SUCCESS)],
          ], { oneTime: true })
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
      flow.step = 'media';
      await promptMediaUpload(ctx, 'နောက်ဆုံးအဆင့်အနေနဲ့ profile photo/video ပို့ပါ။');
      return;
    }

    if (flow.step === 'media') {
      await cleanupMediaUi(ctx);
      await promptMediaUpload(ctx, 'ဒီအဆင့်မှာ photo/video ပဲ ပို့ပေးပါ။');
      return;
    }

    return next();
  });

  bot.on('message', async (ctx, next) => {
    ensureSessionDefaults(ctx);
    if (ctx.session.mediaFlow?.active) {
      await cleanupMediaUi(ctx);
      await promptMediaUpload(ctx, 'ဒီအဆင့်မှာ photo/video ပဲ ပို့ပေးပါ။');
      return;
    }
    return next();
  });
}

module.exports = {
  registerProfileCommands,
  profileSessionMiddleware,
  resetProfileSession,
  resetMediaSession,
  ensureSessionDefaults,
  getProfileByTelegramId,
  getBrowseList,
  sortBrowseProfiles,
  isPremiumActiveUser,
  showGenderList,
  showMyProfile,
  showProfileByProfileId,
  startProfileFlow,
  finishProfileFlow,
};
