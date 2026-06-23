const { Markup } = require('telegraf');
const {
  CUPID_DATABASE_CHANNEL_ID,
  SUPPORT_CHANNEL_ID,
  MAX_PROFILE_MEDIA,
} = require('../config/env');
const { escapeHtml } = require('./escapeHtml');
const {
  BUTTON_STYLE,
  premiumEmoji,
  formatPremiumDate,
  buildPremiumInfoTable,
  buildPremiumProfileRichHtml,
  urlButton,
  inlineKeyboard,
} = require('./keyboards');

let cachedBotUsername = '';

function getDisplayName(from = {}) {
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return fullName || from.username || `User ${from.id || ''}`.trim() || 'Unknown User';
}

function mentionFromTelegramUser(from = {}) {
  const id = Number(from.id);
  const name = escapeHtml(getDisplayName(from));
  if (!Number.isFinite(id) || id <= 0) return name;
  return `<a href="tg://user?id=${id}">${name}</a>`;
}

function mentionFromProfile(user = {}) {
  const id = Number(user.telegramId);
  const name = escapeHtml(user.profileName || user.tgFirstName || user.username || `User ${id || ''}`.trim() || 'Unknown User');
  if (!Number.isFinite(id) || id <= 0) return name;
  return `<a href="tg://user?id=${id}">${name}</a>`;
}

function extractMediaFromMessage(message = {}) {
  const photos = message.photo || [];
  const bestPhoto = photos[photos.length - 1];

  if (bestPhoto?.file_id) {
    return {
      type: 'photo',
      fileId: bestPhoto.file_id,
      fileUniqueId: bestPhoto.file_unique_id || '',
    };
  }

  if (message.video?.file_id) {
    return {
      type: 'video',
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id || '',
    };
  }

  return null;
}

function backupCaption(ctx, mediaType, action = 'create') {
  const title = action === 'update'
    ? '♻️ <b>Cupid Media Post Update</b>'
    : action === 'add'
      ? '➕ <b>Cupid Media Added</b>'
      : '💘 <b>Cupid Media Backup</b>';

  return [
    title,
    '',
    `👤 User: ${mentionFromTelegramUser(ctx.from)}`,
    `🆔 Telegram ID: <code>${ctx.from?.id || '-'}</code>`,
    `📦 Type: <b>${escapeHtml(mediaType)}</b>`,
    `🕒 Date: <code>${new Date().toISOString()}</code>`,
  ].join('\n');
}

async function backupMediaToChannel(ctx, media, action = 'create') {
  if (!media?.fileId || !['photo', 'video'].includes(media.type)) {
    throw new Error('Invalid media payload');
  }

  const caption = backupCaption(ctx, media.type, action);
  const options = { caption, parse_mode: 'HTML' };

  if (media.type === 'photo') {
    return ctx.telegram.sendPhoto(CUPID_DATABASE_CHANNEL_ID, media.fileId, options);
  }

  return ctx.telegram.sendVideo(CUPID_DATABASE_CHANNEL_ID, media.fileId, options);
}

function buildMediaMetadata(media, backupMessage, order = 0, action = 'create') {
  return {
    type: media.type,
    fileId: media.fileId,
    fileUniqueId: media.fileUniqueId || '',
    backupChatId: CUPID_DATABASE_CHANNEL_ID,
    backupMessageId: Number(backupMessage?.message_id || 0),
    backupAction: action,
    order,
    createdAt: new Date(),
  };
}

function normalizeProfileMedia(user = {}) {
  const media = Array.isArray(user.media) ? user.media.filter((item) => item?.fileId && item?.type) : [];
  if (media.length > 0) {
    return media
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .slice(0, MAX_PROFILE_MEDIA);
  }

  // Legacy fallback for older profiles.
  if (user.photoFileId) {
    return [{
      type: 'photo',
      fileId: user.photoFileId,
      fileUniqueId: '',
      backupChatId: 0,
      backupMessageId: 0,
      backupAction: 'legacy',
      order: 0,
      createdAt: user.updatedAt || new Date(),
    }];
  }

  return [];
}

function toInputMedia(media) {
  if (media.type === 'video') {
    return { type: 'video', media: media.fileId };
  }
  return { type: 'photo', media: media.fileId };
}


function isPremiumUser(user = {}) {
  return Boolean(user.premium?.isActive);
}

async function sendRichMessage(ctx, chatId, html, keyboard, fallbackText, extra = {}) {
  const {
    skipEntityDetection = false,
    fallbackParseMode = 'HTML',
    ...apiExtra
  } = extra || {};

  const richMessage = { html };

  // Important: keep entity detection enabled by default so <tg-emoji> custom
  // emoji tags inside channel rich messages are preserved. Setting this to true
  // can make Telegram render only the fallback normal emoji in some channel UI.
  if (typeof skipEntityDetection === 'boolean') {
    richMessage.skip_entity_detection = skipEntityDetection;
  }

  try {
    return await ctx.telegram.callApi('sendRichMessage', {
      chat_id: chatId,
      rich_message: richMessage,
      reply_markup: keyboard?.reply_markup,
      ...apiExtra,
    });
  } catch (error) {
    console.error('SEND_RICH_MESSAGE_FALLBACK:', error?.response?.description || error?.description || error?.message || error);
    return ctx.telegram.sendMessage(chatId, fallbackText, {
      parse_mode: fallbackParseMode,
      disable_web_page_preview: true,
      reply_markup: keyboard?.reply_markup,
    });
  }
}

async function sendMediaOnly(ctx, media) {
  try {
    if (media.type === 'video') return await ctx.replyWithVideo(media.fileId);
    return await ctx.replyWithPhoto(media.fileId);
  } catch (error) {
    if (media.backupChatId && media.backupMessageId) {
      return ctx.telegram.copyMessage(ctx.chat.id, media.backupChatId, media.backupMessageId);
    }
    throw error;
  }
}

async function sendPremiumRichProfileCard(ctx, user, fallbackCaption, keyboard, options = {}) {
  const media = normalizeProfileMedia(user);

  if (ctx.updateType === 'callback_query') {
    try { await ctx.deleteMessage(); } catch (_) {}
  }

  const sentMessages = [];
  if (media.length > 0) {
    if (media.length > 1 && options.album !== false) {
      try {
        const mediaMessages = await ctx.replyWithMediaGroup(media.map(toInputMedia));
        if (Array.isArray(mediaMessages)) sentMessages.push(...mediaMessages);
      } catch (_) {
        for (const item of media) {
          try {
            const msg = await sendMediaOnly(ctx, item);
            sentMessages.push(msg);
          } catch (_) {}
        }
      }
    } else {
      try {
        const msg = await sendMediaOnly(ctx, media[0]);
        sentMessages.push(msg);
      } catch (_) {}
    }
  }

  const html = buildPremiumProfileRichHtml(user, {
    title: options.richTitle || 'PREMIUM CUPID PROFILE',
    mediaCount: media.length,
    includePagination: Boolean(options.includePagination),
    index: options.index,
    total: options.total,
  });

  const richMsg = await sendRichMessage(ctx, ctx.chat.id, html, keyboard, fallbackCaption);
  sentMessages.push(richMsg);
  return sentMessages.filter(Boolean);
}

async function sendSingleMedia(ctx, media, caption, keyboard) {
  const payload = {
    caption,
    parse_mode: 'HTML',
    reply_markup: keyboard?.reply_markup,
  };

  try {
    if (media.type === 'video') return await ctx.replyWithVideo(media.fileId, payload);
    return await ctx.replyWithPhoto(media.fileId, payload);
  } catch (error) {
    if (media.backupChatId && media.backupMessageId) {
      return ctx.telegram.copyMessage(ctx.chat.id, media.backupChatId, media.backupMessageId, payload);
    }
    throw error;
  }
}

async function editOrSendSingleMedia(ctx, media, caption, keyboard) {
  const mediaPayload = {
    type: media.type,
    media: media.fileId,
    caption,
    parse_mode: 'HTML',
  };

  try {
    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageMedia(mediaPayload, { reply_markup: keyboard?.reply_markup });
      return ctx.callbackQuery?.message || null;
    }
  } catch (_) {
    try {
      if (ctx.updateType === 'callback_query') await ctx.deleteMessage();
    } catch (_) {}
  }

  return sendSingleMedia(ctx, media, caption, keyboard);
}

async function sendProfileCard(ctx, user, caption, keyboard, options = {}) {
  const media = normalizeProfileMedia(user);

  if (options.premiumRich && isPremiumUser(user)) {
    return sendPremiumRichProfileCard(ctx, user, caption, keyboard, options);
  }

  if (media.length === 0) {
    if (ctx.updateType === 'callback_query') {
      try {
        await ctx.editMessageText(caption, { parse_mode: 'HTML', reply_markup: keyboard?.reply_markup });
        return [ctx.callbackQuery?.message].filter(Boolean);
      } catch (_) {}
    }
    const msg = await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: keyboard?.reply_markup });
    return [msg].filter(Boolean);
  }

  if (media.length === 1 || !options.album) {
    const msg = await editOrSendSingleMedia(ctx, media[0], caption, keyboard);
    return [msg].filter(Boolean);
  }

  // Telegram media groups cannot hold one inline keyboard for the whole album.
  // Stable UI: send all profile media first, then send profile info + buttons below it.
  if (ctx.updateType === 'callback_query') {
    try { await ctx.deleteMessage(); } catch (_) {}
  }

  const sentMessages = [];
  try {
    const mediaMessages = await ctx.replyWithMediaGroup(media.map(toInputMedia));
    if (Array.isArray(mediaMessages)) sentMessages.push(...mediaMessages);
  } catch (_) {
    for (const item of media) {
      try {
        const msg = item.type === 'video'
          ? await ctx.replyWithVideo(item.fileId)
          : await ctx.replyWithPhoto(item.fileId);
        sentMessages.push(msg);
      } catch (error) {
        if (item.backupChatId && item.backupMessageId) {
          try {
            const copied = await ctx.telegram.copyMessage(ctx.chat.id, item.backupChatId, item.backupMessageId);
            sentMessages.push(copied);
          } catch (_) {}
        }
      }
    }
  }

  const textMessage = await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: keyboard?.reply_markup });
  sentMessages.push(textMessage);
  return sentMessages.filter(Boolean);
}

function mediaDoneKeyboard() {
  return Markup.inlineKeyboard([
    [
      { text: '✅ Done', callback_data: 'media:done', style: 'success' },
      { text: '❌ Cancel', callback_data: 'media:cancel', style: 'danger' },
    ],
  ]);
}

async function getBotUsername(ctx) {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await ctx.telegram.getMe();
    cachedBotUsername = me?.username || '';
  } catch (_) {}
  return cachedBotUsername;
}


function buildNewUserAlertRichHtml(user) {
  const mediaCount = normalizeProfileMedia(user).length;
  const icon = (key, fallback) => premiumEmoji(key, fallback, true);
  const until = formatPremiumDate(user.premium?.expiresAt);
  const rows = [
    [icon('profileId', '🪪') + ' Profile ID', `<code>${escapeHtml(user.profileId || '-')}</code>`],
    [icon('profileId', '🪪') + ' Telegram ID', `<code>${escapeHtml(user.telegramId || '-')}</code>`],
    [icon('username', '❤️') + ' Username', user.username ? `<code>@${escapeHtml(user.username)}</code>` : '-'],
    [icon('user', '👤') + ' Name', escapeHtml(user.profileName || '-')],
    [icon('gender', '🔞') + ' Gender', escapeHtml(user.gender || '-')],
    [icon('status', '💕') + ' Status', escapeHtml(user.relationshipStatus || '-')],
    [icon('age', '🎂') + ' Age', escapeHtml(user.age || '-')],
    [icon('height', '🤩') + ' Height', escapeHtml(user.height || '-')],
    [icon('location', '📍') + ' Address', escapeHtml(user.address || '-')],
    [icon('hobby', '🎁') + ' Hobby', escapeHtml(user.hobby || '-')],
    [icon('media', '🖼') + ' Media', `<b>${escapeHtml(`${mediaCount}/${MAX_PROFILE_MEDIA}`)}</b>`],
  ];
  const tableRows = rows.map(([label, value]) => `<tr><td><b>${label}</b></td><td>${value}</td></tr>`).join('');
  return [
    `<h3>🆕${icon('diamond', '💎')} NEW PREMIUM USER ALERT</h3>`,
    `<blockquote>${icon('crown', '👑')} <b>Premium User</b> ${icon('hourglass', '⏳')} <code>${escapeHtml(until)}</code></blockquote>`,
    `<p>${icon('user', '👤')} User: ${mentionFromProfile(user)}</p>`,
    `<table bordered striped><caption>${icon('diamond', '💎')} Premium User Info</caption><tr><th>Field</th><th>Value</th></tr>${tableRows}</table>`,
    `<footer>🕒 Created: <code>${new Date().toISOString()}</code></footer>`,
  ].join('\n');
}

function buildNewUserAlertText(user) {
  const mediaCount = normalizeProfileMedia(user).length;
  const isPremium = Boolean(user.premium?.isActive);
  const icon = (key, fallback) => premiumEmoji(key, fallback, isPremium);

  if (isPremium) {
    const until = formatPremiumDate(user.premium?.expiresAt);
    const table = buildPremiumInfoTable([
      ['Profile ID', user.profileId || '-'],
      ['Telegram ID', user.telegramId || '-'],
      ['Username', user.username ? `@${user.username}` : '-'],
      ['Name', user.profileName || '-'],
      ['Gender', user.gender || '-'],
      ['Status', user.relationshipStatus || '-'],
      ['Age', user.age || '-'],
      ['Height', user.height || '-'],
      ['Address', user.address || '-'],
      ['Hobby', user.hobby || '-'],
      ['Media', `${mediaCount}/${MAX_PROFILE_MEDIA}`],
    ]);

    return [
      `🆕${icon('diamond', '💎')} <b>NEW PREMIUM USER ALERT</b>`,
      `${icon('crown', '👑')} <b>Premium User</b>   ${icon('hourglass', '⏳')} <code>${escapeHtml(until)}</code>`,
      '',
      `${icon('user', '👤')} User: ${mentionFromProfile(user)}`,
      '',
      `<pre>${escapeHtml(table)}</pre>`,
      '',
      `🕒 Created: <code>${new Date().toISOString()}</code>`,
    ].join('\n');
  }

  return [
    '🆕 <b>New User Alert</b>',
    '',
    `👤 User: ${mentionFromProfile(user)}`,
    `🆔 Profile ID: <code>${escapeHtml(user.profileId || '-')}</code>`,
    `🆔 Telegram ID: <code>${user.telegramId || '-'}</code>`,
    `🧾 Username: ${user.username ? `@${escapeHtml(user.username)}` : 'မရှိသေးပါ'}`,
    '',
    '💘 <b>User Info</b>',
    `👤 နာမည်: <b>${escapeHtml(user.profileName || '-')}</b>`,
    `⚧ လိင်: <b>${escapeHtml(user.gender || '-')}</b>`,
    `💞 Status: <b>${escapeHtml(user.relationshipStatus || '-')}</b>`,
    `🎂 အသက်: <b>${escapeHtml(user.age || '-')}</b>`,
    `📏 အရပ်: <b>${escapeHtml(user.height || '-')}</b>`,
    `📍 နေရပ်: <b>${escapeHtml(user.address || '-')}</b>`,
    `🎯 ဝါသနာ: <b>${escapeHtml(user.hobby || '-')}</b>`,
    `🖼 Profile Media: <b>${mediaCount}/${MAX_PROFILE_MEDIA}</b>`,
    '',
    `🕒 Created: <code>${new Date().toISOString()}</code>`,
  ].join('\n');
}

async function sendMediaToSupportChannel(ctx, media) {
  const sent = [];
  if (!media.length) return sent;

  try {
    if (media.length > 1) {
      const mediaMessages = await ctx.telegram.sendMediaGroup(SUPPORT_CHANNEL_ID, media.map(toInputMedia));
      if (Array.isArray(mediaMessages)) sent.push(...mediaMessages);
      return sent;
    }

    const item = media[0];
    const msg = item.type === 'video'
      ? await ctx.telegram.sendVideo(SUPPORT_CHANNEL_ID, item.fileId)
      : await ctx.telegram.sendPhoto(SUPPORT_CHANNEL_ID, item.fileId);
    sent.push(msg);
    return sent;
  } catch (error) {
    for (const item of media) {
      if (item.backupChatId && item.backupMessageId) {
        try {
          const copied = await ctx.telegram.copyMessage(SUPPORT_CHANNEL_ID, item.backupChatId, item.backupMessageId);
          sent.push(copied);
        } catch (_) {}
      }
    }
    return sent;
  }
}

async function sendNewUserAlertToSupportChannel(ctx, user) {
  if (!Number.isFinite(SUPPORT_CHANNEL_ID) || SUPPORT_CHANNEL_ID === 0) return;

  try {
    const media = normalizeProfileMedia(user);
    await sendMediaToSupportChannel(ctx, media);

    const botUsername = await getBotUsername(ctx);
    const startUrl = botUsername
      ? `https://t.me/${botUsername}?start=profile_${user.telegramId}`
      : `tg://user?id=${user.telegramId}`;

    const alertKeyboard = inlineKeyboard([
      [urlButton('💘 ရည်းစားရှာရန်', startUrl, BUTTON_STYLE.SUCCESS)],
    ]);
    const fallbackText = buildNewUserAlertText(user);

    if (isPremiumUser(user)) {
      await sendRichMessage(ctx, SUPPORT_CHANNEL_ID, buildNewUserAlertRichHtml(user), alertKeyboard, fallbackText, {
        skipEntityDetection: false,
      });
      return;
    }

    await ctx.telegram.sendMessage(SUPPORT_CHANNEL_ID, fallbackText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: alertKeyboard.reply_markup,
    });
  } catch (error) {
    console.error('NEW_USER_ALERT_ERROR:', error);
  }
}

module.exports = {
  mentionFromTelegramUser,
  mentionFromProfile,
  extractMediaFromMessage,
  backupMediaToChannel,
  buildMediaMetadata,
  normalizeProfileMedia,
  toInputMedia,
  sendProfileCard,
  mediaDoneKeyboard,
  sendNewUserAlertToSupportChannel,
};
