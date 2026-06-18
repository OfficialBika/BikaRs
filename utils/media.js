const { Markup } = require('telegraf');
const { CUPID_DATABASE_CHANNEL_ID, MAX_PROFILE_MEDIA } = require('../config/env');
const { escapeHtml } = require('./escapeHtml');

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
      return;
    }
  } catch (_) {
    try {
      if (ctx.updateType === 'callback_query') await ctx.deleteMessage();
    } catch (_) {}
  }

  await sendSingleMedia(ctx, media, caption, keyboard);
}

async function sendProfileCard(ctx, user, caption, keyboard, options = {}) {
  const media = normalizeProfileMedia(user);

  if (media.length === 0) {
    if (ctx.updateType === 'callback_query') {
      try {
        await ctx.editMessageText(caption, { parse_mode: 'HTML', reply_markup: keyboard?.reply_markup });
        return;
      } catch (_) {}
    }
    await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: keyboard?.reply_markup });
    return;
  }

  if (media.length === 1 || !options.album) {
    await editOrSendSingleMedia(ctx, media[0], caption, keyboard);
    return;
  }

  // Album messages cannot keep inline keyboard reliably, so send media first and
  // then send the profile caption + buttons as a separate message.
  if (ctx.updateType === 'callback_query') {
    try { await ctx.deleteMessage(); } catch (_) {}
  }

  try {
    await ctx.replyWithMediaGroup(media.map(toInputMedia));
  } catch (_) {
    for (const item of media) {
      try {
        if (item.type === 'video') await ctx.replyWithVideo(item.fileId);
        else await ctx.replyWithPhoto(item.fileId);
      } catch (error) {
        if (item.backupChatId && item.backupMessageId) {
          try { await ctx.telegram.copyMessage(ctx.chat.id, item.backupChatId, item.backupMessageId); } catch (_) {}
        }
      }
    }
  }

  await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: keyboard?.reply_markup });
}

function mediaDoneKeyboard() {
  return Markup.inlineKeyboard([
    [
      { text: '✅ Done', callback_data: 'media:done', style: 'success' },
      { text: '❌ Cancel', callback_data: 'media:cancel', style: 'danger' },
    ],
  ]);
}

module.exports = {
  mentionFromTelegramUser,
  mentionFromProfile,
  extractMediaFromMessage,
  backupMediaToChannel,
  buildMediaMetadata,
  normalizeProfileMedia,
  sendProfileCard,
  mediaDoneKeyboard,
};
