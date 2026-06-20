const {
  REQUIRE_SUPPORT_JOIN,
  SUPPORT_CHANNEL_ID,
  SUPPORT_GROUP_ID,
  SUPPORT_CHANNEL_URL,
  SUPPORT_GROUP_URL,
} = require('../config/env');
const { isAdmin } = require('./auth');
const { isPrivateChat } = require('./privateOnly');
const {
  BUTTON_STYLE,
  callbackButton,
  urlButton,
  inlineKeyboard,
} = require('../utils/keyboards');

const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);
let cachedInviteLinks = {
  channel: '',
  group: '',
};

function isEnabled() {
  return Boolean(REQUIRE_SUPPORT_JOIN);
}

function isActionableUpdate(ctx) {
  if (ctx.updateType === 'callback_query') return true;

  const text = String(ctx.message?.text || '').trim();
  if (!text) return isPrivateChat(ctx) && Boolean(ctx.message?.photo || ctx.message?.video);

  if (text.startsWith('/')) return true;

  return [
    '📝 Profile ဖြည့်ရန်',
    '👤 ကျွန်ုပ်၏ Profile',
    '👧 Girls List',
    '👦 Boys List',
    '✏️ Profile ပြင်ရန်',
    '🖼 ပုံထည့်/ပြင်မယ်',
    '🎲 ကျပန်း Profile ကြည့်ရန်',
    'ℹ️ အကူအညီ',
  ].includes(text);
}

function getCommand(ctx) {
  const text = String(ctx.message?.text || '').trim();
  if (!text.startsWith('/')) return '';
  const command = text.split(/\s+/)[0].replace(/^\//, '').split('@')[0].toLowerCase();
  return command;
}

function isGroupAllowedCommand(ctx) {
  const command = getCommand(ctx);
  return command === 'start' || command === 'check';
}

function isAlwaysAllowed(ctx) {
  if (ctx.updateType === 'callback_query') {
    const data = String(ctx.callbackQuery?.data || '');
    return data === 'support:group' || data === 'support:channel' || data === 'membership:check';
  }

  const command = getCommand(ctx);
  return command === 'start';
}

async function getInviteLink(ctx, type) {
  const isChannel = type === 'channel';
  const envUrl = isChannel ? SUPPORT_CHANNEL_URL : SUPPORT_GROUP_URL;
  if (envUrl) return envUrl;

  if (cachedInviteLinks[type]) return cachedInviteLinks[type];

  const chatId = isChannel ? SUPPORT_CHANNEL_ID : SUPPORT_GROUP_ID;
  const invite = await ctx.telegram.createChatInviteLink(chatId, {
    name: `Cupid Bot required ${type}`,
    creates_join_request: false,
  });

  cachedInviteLinks[type] = invite.invite_link;
  return cachedInviteLinks[type];
}

async function buildJoinKeyboard(ctx) {
  const rows = [];

  let groupButton = callbackButton('👥 Join Support Group', 'support:group', BUTTON_STYLE.PRIMARY);
  let channelButton = callbackButton('📢 Join Support Channel', 'support:channel', BUTTON_STYLE.PRIMARY);

  try {
    const groupUrl = await getInviteLink(ctx, 'group');
    if (groupUrl) groupButton = urlButton('👥 Join Support Group', groupUrl, BUTTON_STYLE.PRIMARY);
  } catch (_) {}

  try {
    const channelUrl = await getInviteLink(ctx, 'channel');
    if (channelUrl) channelButton = urlButton('📢 Join Support Channel', channelUrl, BUTTON_STYLE.PRIMARY);
  } catch (_) {}

  rows.push([groupButton, channelButton]);
  rows.push([callbackButton('✅ Joined / Check Again', 'membership:check', BUTTON_STYLE.SUCCESS)]);

  return inlineKeyboard(rows);
}

async function sendDmButton(ctx, text) {
  const botUsername = ctx.botInfo?.username;
  const keyboard = botUsername
    ? inlineKeyboard([[urlButton('💬 Bot DM ဖွင့်ရန်', `https://t.me/${botUsername}?start=main`, BUTTON_STYLE.PRIMARY)]])
    : undefined;

  await ctx.reply(text, keyboard ? { reply_markup: keyboard.reply_markup } : undefined).catch(() => {});
}

async function getMembershipStatus(ctx, chatId, userId) {
  try {
    const member = await ctx.telegram.getChatMember(chatId, userId);
    const status = member?.status || '';
    const isMember = MEMBER_STATUSES.has(status) || (status === 'restricted' && member?.is_member === true);
    return { ok: isMember, status, error: null };
  } catch (error) {
    return { ok: false, status: 'unknown', error };
  }
}

async function checkRequiredMembership(ctx, userId = ctx.from?.id) {
  if (!isEnabled()) {
    return {
      ok: true,
      channel: { ok: true, status: 'disabled', error: null },
      group: { ok: true, status: 'disabled', error: null },
    };
  }

  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    return {
      ok: false,
      channel: { ok: false, status: 'invalid_user', error: null },
      group: { ok: false, status: 'invalid_user', error: null },
    };
  }

  const [channel, group] = await Promise.all([
    getMembershipStatus(ctx, SUPPORT_CHANNEL_ID, uid),
    getMembershipStatus(ctx, SUPPORT_GROUP_ID, uid),
  ]);

  return {
    ok: Boolean(channel.ok && group.ok),
    channel,
    group,
  };
}

function buildJoinRequiredText(status) {
  const channelOk = status?.channel?.ok;
  const groupOk = status?.group?.ok;

  return [
    '🔒 <b>Cupid Bot ကို အသုံးပြုရန် Support Group နှင့် Support Channel ကို join ထားရပါမယ်။</b>',
    '',
    `${groupOk ? '✅' : '❌'} Support Group`,
    `${channelOk ? '✅' : '❌'} Support Channel`,
    '',
    'Join ပြီးရင် <b>✅ Joined / Check Again</b> ကိုနှိပ်ပါ။',
  ].join('\n');
}

async function promptJoinRequired(ctx, status) {
  const keyboard = await buildJoinKeyboard(ctx);
  const text = buildJoinRequiredText(status);

  if (ctx.updateType === 'callback_query') {
    await ctx.answerCbQuery('Support Group + Channel join လိုအပ်ပါတယ်။', { show_alert: true }).catch(() => {});
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
      });
      return;
    } catch (_) {}
  }

  if (!isPrivateChat(ctx)) {
    await sendDmButton(ctx, 'ဒီ bot ကိုအသုံးပြုရန် Support Group/Channel join စစ်ဆေးမှုကို DM ထဲမှာလုပ်ပါ။');
    return;
  }

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard.reply_markup,
  }).catch(() => {});
}

async function requireSupportMembership(ctx, options = {}) {
  if (!isEnabled()) return true;
  if (!ctx.from?.id) return true;
  if (isAdmin(ctx.from.id)) return true;

  const status = await checkRequiredMembership(ctx, ctx.from.id);
  if (status.ok) return true;

  if (options.prompt !== false) await promptJoinRequired(ctx, status);
  return false;
}

function requiredMembershipMiddleware() {
  return async (ctx, next) => {
    if (!isEnabled()) return next();
    if (!ctx.from?.id) return next();
    if (isAdmin(ctx.from.id)) return next();

    // In groups/supergroups, keep the bot quiet. Only /start and /check are allowed.
    // This prevents reply menus and join-gate prompts from spamming group chats.
    if (!isPrivateChat(ctx)) {
      if (ctx.updateType === 'callback_query') {
        await ctx.answerCbQuery('DM ထဲမှာပဲ အသုံးပြုနိုင်ပါတယ်။', { show_alert: true }).catch(() => {});
        return;
      }

      if (!isGroupAllowedCommand(ctx)) return;

      if (getCommand(ctx) === 'start') return next();

      // /check is allowed in groups, but still requires Support Group + Channel membership.
      if (!(await requireSupportMembership(ctx))) return;
      return next();
    }

    if (isAlwaysAllowed(ctx)) return next();
    if (!isActionableUpdate(ctx)) return next();

    if (!(await requireSupportMembership(ctx))) return;
    return next();
  };
}

module.exports = {
  checkRequiredMembership,
  requireSupportMembership,
  requiredMembershipMiddleware,
  promptJoinRequired,
  buildJoinKeyboard,
};
