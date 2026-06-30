const User = require('../models/User');
const Reaction = require('../models/Reaction');
const Report = require('../models/Report');
const { isAdmin } = require('../middlewares/auth');
const { escapeHtml } = require('../utils/escapeHtml');
const { BUTTON_STYLE, callbackButton, inlineKeyboard } = require('../utils/keyboards');
const {
  isPremiumOwner,
  parsePremiumDuration,
  resolvePremiumTarget,
  grantPremium,
  revokePremium,
  getActivePremiumByTelegramId,
  formatPremiumUntil,
} = require('../utils/premium');
const {
  sendProfileCard,
  sendPremiumBuyerAlertToSupportChannel,
} = require('../utils/media');
const {
  startBroadcast,
  stopBroadcast,
  showBroadcastStatus,
  resumeBroadcast,
} = require('../utils/broadcast');


function ensureAdminReportUiSession(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.adminReportUi) ctx.session.adminReportUi = { messageIds: [] };
}

function normalizeMessageIds(messagesOrMessage) {
  const items = Array.isArray(messagesOrMessage) ? messagesOrMessage : [messagesOrMessage];
  return items
    .map((message) => Number(message?.message_id || message))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function rememberAdminReportMessages(ctx, messagesOrMessage) {
  ensureAdminReportUiSession(ctx);
  const ids = normalizeMessageIds(messagesOrMessage);
  ctx.session.adminReportUi.messageIds = [...new Set(ids)].slice(-30);
}

async function safeDeleteMessage(ctx, messageId) {
  const id = Number(messageId);
  if (!Number.isFinite(id) || id <= 0 || !ctx.chat?.id) return;
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, id);
  } catch (_) {}
}

async function cleanupAdminReportUi(ctx, options = {}) {
  ensureAdminReportUiSession(ctx);
  const ids = Array.isArray(ctx.session.adminReportUi.messageIds)
    ? [...ctx.session.adminReportUi.messageIds]
    : [];
  if (options.includeCurrentCallback && ctx.callbackQuery?.message?.message_id) {
    ids.push(ctx.callbackQuery.message.message_id);
  }
  for (const id of [...new Set(ids)]) {
    await safeDeleteMessage(ctx, id);
  }
  ctx.session.adminReportUi = { messageIds: [] };
}

function buildReportText(report, target, reporter, currentIndex, totalReports) {
  return [
    '🚨 <b>Reported Profile</b>',
    '',
    `Report: <b>${currentIndex + 1}/${totalReports}</b>`,
    `Target Profile ID: <code>${target?.profileId || '-'}</code>`,
    `Target Telegram ID: <code>${report.targetUserId}</code>`,
    `Reporter Profile ID: <code>${reporter?.profileId || '-'}</code>`,
    `Reporter Telegram ID: <code>${report.reporterId}</code>`,
    `Target Name: ${escapeHtml(target?.profileName || 'Deleted User')}`,
    `Reporter Name: ${escapeHtml(reporter?.profileName || reporter?.tgFirstName || 'Unknown')}`,
    `Reason: ${escapeHtml(report.reason || '-')}`,
    `Status: ${escapeHtml(report.status)}`,
  ].join('\n');
}

function buildReportKeyboard(report, currentIndex, totalReports) {
  return inlineKeyboard([
    [
      callbackButton('⬅️ Prev', `admin:reports:${Math.max(currentIndex - 1, 0)}`, BUTTON_STYLE.PRIMARY),
      callbackButton('➡️ Next', `admin:reports:${Math.min(currentIndex + 1, totalReports - 1)}`, BUTTON_STYLE.PRIMARY),
    ],
    [
      callbackButton('🚫 Ban Target', `admin:banreport:${report.targetUserId}`, BUTTON_STYLE.DANGER),
      callbackButton('🗑 Delete Target', `admin:delreport:${report.targetUserId}`, BUTTON_STYLE.DANGER),
    ],
    [callbackButton('✅ Ignore Report', `admin:ignorereport:${report._id}`, BUTTON_STYLE.SUCCESS)],
  ]);
}

async function sendReportedProfileCard(ctx, report, target, reporter, currentIndex, totalReports) {
  const text = buildReportText(report, target, reporter, currentIndex, totalReports);
  const keyboard = buildReportKeyboard(report, currentIndex, totalReports);

  await cleanupAdminReportUi(ctx, { includeCurrentCallback: true });

  if (target?.isProfileComplete && !target?.isBanned) {
    const sentMessages = await sendProfileCard(ctx, target, text, keyboard, { album: true });
    rememberAdminReportMessages(ctx, sentMessages);
    return;
  }

  const msg = await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
  rememberAdminReportMessages(ctx, msg);
}


function premiumUsage() {
  return [
    '💎 <b>Premium Commands</b>',
    '',
    '<code>/setpre userId 30days</code>',
    '<code>/setpre @username 30days</code>',
    '<code>/unpre userId</code>',
    '<code>/precheck userId</code>',
    '',
    'ဥပမာ - <code>/setpre 123456789 30days</code>',
  ].join('\n');
}

async function requirePremiumOwner(ctx, options = {}) {
  if (isPremiumOwner(ctx.from?.id)) return true;
  if (!options.silent) {
    await ctx.reply('ဒီ command ကို Premium Owner account မှသာ အသုံးပြုနိုင်ပါတယ်။');
  }
  return false;
}

async function handleSetPremium(ctx) {
  if (!(await requirePremiumOwner(ctx, { silent: true }))) return;

  const parts = String(ctx.message?.text || '').trim().split(/\s+/);
  const targetArg = parts[1];
  const durationArg = parts[2];

  if (!targetArg || !durationArg) {
    await ctx.reply(premiumUsage(), { parse_mode: 'HTML' });
    return;
  }

  const days = parsePremiumDuration(durationArg);
  if (!days) {
    await ctx.reply('Duration format မှားနေပါတယ်။ ဥပမာ - <code>30days</code>, <code>7days</code>, <code>1day</code>', { parse_mode: 'HTML' });
    return;
  }

  const target = await resolvePremiumTarget(targetArg);
  if (!target) {
    await ctx.reply('Target user မတွေ့ပါ။ Username နဲ့သုံးမယ်ဆိုရင် အဲဒီ user က bot ကို အရင် /start နှိပ်ထားရပါမယ်။');
    return;
  }

  const record = await grantPremium(target, days, ctx.from.id);

  const targetUser = target.user || await User.findOne({ telegramId: Number(target.telegramId) }).lean();
  if (targetUser) {
    const premiumTargetUser = {
      ...targetUser,
      telegramId: Number(target.telegramId),
      username: target.username || targetUser.username || '',
      profileId: target.profileId || targetUser.profileId || 0,
      premium: {
        isActive: true,
        expiresAt: record.expiresAt,
        durationDays: record.durationDays || days,
        grantedBy: record.grantedBy || ctx.from.id,
      },
    };
    await sendPremiumBuyerAlertToSupportChannel(ctx, premiumTargetUser, {
      expiresAt: record.expiresAt,
      durationDays: record.durationDays || days,
      grantedBy: ctx.from.id,
    });
  }

  await ctx.reply([
    '✅ <b>Premium User ထည့်ပြီးပါပြီ</b>',
    '',
    `👤 Telegram ID: <code>${target.telegramId}</code>`,
    `🆔 Profile ID: <code>${target.profileId || '-'}</code>`,
    `🧾 Username: ${target.username ? `@${target.username}` : '-'}`,
    `💎 Duration: <b>${days} days</b>`,
    `⏳ Expires: <code>${formatPremiumUntil(record.expiresAt)}</code>`,
  ].join('\n'), { parse_mode: 'HTML' });
}

async function handleRemovePremium(ctx) {
  if (!(await requirePremiumOwner(ctx, { silent: true }))) return;

  const parts = String(ctx.message?.text || '').trim().split(/\s+/);
  const targetArg = parts[1];
  if (!targetArg) {
    await ctx.reply('အသုံးပြုပုံ - <code>/unpre userId</code> သို့မဟုတ် <code>/unpre @username</code>', { parse_mode: 'HTML' });
    return;
  }

  const target = await resolvePremiumTarget(targetArg);
  if (!target) {
    await ctx.reply('Target user မတွေ့ပါ။');
    return;
  }

  await revokePremium(target, ctx.from.id);
  await ctx.reply(`✅ Premium ဖြုတ်ပြီးပါပြီ။\n👤 Telegram ID: <code>${target.telegramId}</code>`, { parse_mode: 'HTML' });
}

async function handlePremiumCheck(ctx) {
  if (!(await requirePremiumOwner(ctx, { silent: true }))) return;

  const parts = String(ctx.message?.text || '').trim().split(/\s+/);
  const targetArg = parts[1];
  if (!targetArg) {
    await ctx.reply('အသုံးပြုပုံ - <code>/precheck userId</code> သို့မဟုတ် <code>/precheck @username</code>', { parse_mode: 'HTML' });
    return;
  }

  const target = await resolvePremiumTarget(targetArg);
  if (!target) {
    await ctx.reply('Target user မတွေ့ပါ။');
    return;
  }

  const record = await getActivePremiumByTelegramId(target.telegramId);
  if (!record) {
    await ctx.reply(`ℹ️ Premium မရှိပါ။\n👤 Telegram ID: <code>${target.telegramId}</code>`, { parse_mode: 'HTML' });
    return;
  }

  await ctx.reply([
    '💎 <b>Premium Active</b>',
    '',
    `👤 Telegram ID: <code>${target.telegramId}</code>`,
    `🆔 Profile ID: <code>${target.profileId || '-'}</code>`,
    `🧾 Username: ${target.username ? `@${target.username}` : '-'}`,
    `⏳ Expires: <code>${formatPremiumUntil(record.expiresAt)}</code>`,
  ].join('\n'), { parse_mode: 'HTML' });
}

function registerAdminCommands(bot) {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('ဒီ command ကို admin များသာ အသုံးပြုနိုင်ပါသည်။');
      return;
    }

    await ctx.reply('🛠 <b>Admin Panel</b>', {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard([
        [callbackButton('📊 User Count', 'admin:count', BUTTON_STYLE.PRIMARY)],
        [callbackButton('🚨 Reported Profiles', 'admin:reports:0', BUTTON_STYLE.DANGER)],
        [callbackButton('📢 Broadcast Guide', 'admin:broadcast:help', BUTTON_STYLE.PRIMARY)],
        [callbackButton('📡 Broadcast Status', 'admin:broadcast:status', BUTTON_STYLE.SUCCESS)],
      ]).reply_markup,
    });
  });


  bot.command('setpre', handleSetPremium);
  bot.command('unpre', handleRemovePremium);
  bot.command('precheck', handlePremiumCheck);

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
    await startBroadcast(ctx, bot);
  });

  bot.command(['stop_broadcast', 'stop_gcast'], async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await stopBroadcast(ctx);
  });

  bot.command('broadcast_status', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await showBroadcastStatus(ctx);
  });

  bot.command('broadcast_resume', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await resumeBroadcast(ctx, bot);
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
    await ctx.reply([
      '📢 <b>Pro Broadcast Guide</b>',
      '',
      'ပို့ချင်တဲ့ message ကို reply လုပ်ပြီး /broadcast ရိုက်ပါ။',
      '',
      '<code>/broadcast</code> - clean copy ပို့မယ်',
      '<code>/broadcast -forward</code> - forward အနေနဲ့ပို့မယ်',
      '<code>/broadcast -completed</code> - profile complete users ကိုပဲပို့မယ်',
      '<code>/stop_broadcast</code> - active broadcast ရပ်မယ်',
      '<code>/broadcast_status</code> - latest status ကြည့်မယ်',
      '<code>/broadcast_resume &lt;jobId&gt;</code> - ရပ်သွားတဲ့ job ကို resume လုပ်မယ်',
      '',
      'ပို့ပြီးသား users တွေကို delivery log နဲ့သိမ်းထားတဲ့အတွက် resume လုပ်ရင် ထပ်မပို့ပါ။',
    ].join('\n'), { parse_mode: 'HTML' });
  });

  bot.action('admin:broadcast:status', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    await showBroadcastStatus(ctx);
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

    await ctx.answerCbQuery();
    await sendReportedProfileCard(ctx, report, target, reporter, currentIndex, reports.length);
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
}

module.exports = {
  registerAdminCommands,
};
