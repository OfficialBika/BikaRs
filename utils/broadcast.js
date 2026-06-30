const User = require('../models/User');
const BroadcastJob = require('../models/BroadcastJob');
const BroadcastDelivery = require('../models/BroadcastDelivery');
const {
  BROADCAST_DELAY_MS,
  BROADCAST_PROGRESS_EVERY,
} = require('../config/env');

const activeRuntimeJobs = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBroadcastTokens(text = '') {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasBroadcastOption(tokens, ...names) {
  const set = new Set(tokens);
  return names.some((name) => {
    const normalized = String(name || '').toLowerCase();
    return set.has(normalized) || set.has(`-${normalized}`);
  });
}

function parseBroadcastArgs(text = '') {
  const tokens = normalizeBroadcastTokens(text);
  const forward = hasBroadcastOption(tokens, 'forward');
  const copy = hasBroadcastOption(tokens, 'copy', 'clean') || tokens.includes('-') || !forward;

  return {
    // copy mode is the clean broadcast mode. It copies the message without a
    // forwarded header and preserves inline buttons from the replied message.
    mode: forward && !copy ? 'forward' : 'copy',
    target: hasBroadcastOption(tokens, 'completed') ? 'completed' : 'all',
    includeBanned: hasBroadcastOption(tokens, 'banned', 'all'),
    keepButtons: !hasBroadcastOption(tokens, 'no-buttons', 'nobuttons'),
  };
}

function cloneReplyMarkup(replyMarkup) {
  if (!replyMarkup || typeof replyMarkup !== 'object') return null;
  if (!Array.isArray(replyMarkup.inline_keyboard) || replyMarkup.inline_keyboard.length === 0) return null;

  try {
    return JSON.parse(JSON.stringify(replyMarkup));
  } catch (_) {
    return null;
  }
}

function countInlineButtons(replyMarkup) {
  if (!Array.isArray(replyMarkup?.inline_keyboard)) return 0;
  return replyMarkup.inline_keyboard.reduce((total, row) => total + (Array.isArray(row) ? row.length : 0), 0);
}

function buildRecipientQuery(job) {
  const query = {
    telegramId: { $exists: true, $ne: null },
  };

  if (!job.includeBanned) query.isBanned = false;
  if (job.target === 'completed') query.isProfileComplete = true;

  return query;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds}s`;
}

function buildBroadcastStatusText(job, extra = '') {
  const done = Number(job.sentCount || 0) + Number(job.failedCount || 0) + Number(job.skippedCount || 0);
  const total = Number(job.totalCount || 0);
  const percent = total > 0 ? Math.floor((done / total) * 100) : 0;
  const elapsed = job.startedAt ? formatDuration(Date.now() - new Date(job.startedAt).getTime()) : '0m 0s';

  return [
    `📢 <b>Broadcast ${job.status}</b>`,
    '',
    `Job ID: <code>${job._id}</code>`,
    `Mode: <b>${job.mode}</b>` + ` | Target: <b>${job.target}</b>`,
    `Progress: <b>${done}/${total}</b> (${percent}%)`,
    `✅ Sent: <b>${job.sentCount || 0}</b>`,
    `⏭ Skipped: <b>${job.skippedCount || 0}</b>`,
    `❌ Failed: <b>${job.failedCount || 0}</b>`,
    `⏱ Elapsed: <b>${elapsed}</b>`,
    extra ? `\n${extra}` : '',
  ].filter(Boolean).join('\n');
}

async function safeEditStatus(telegram, job, extra = '') {
  if (!job.statusChatId || !job.statusMessageId) return;
  try {
    await telegram.editMessageText(
      job.statusChatId,
      job.statusMessageId,
      undefined,
      buildBroadcastStatusText(job, extra),
      { parse_mode: 'HTML' }
    );
  } catch (_) {}
}

function getRetryAfterSeconds(error) {
  const retryAfter = Number(error?.parameters?.retry_after || error?.response?.parameters?.retry_after || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;
  return 0;
}

function getTelegramErrorCode(error) {
  return String(error?.code || error?.error_code || error?.response?.error_code || 'ERROR');
}

function getTelegramErrorMessage(error) {
  return String(error?.description || error?.message || error?.response?.description || 'Unknown error').slice(0, 500);
}

async function copyOrForwardMessage(telegram, job, chatId) {
  if (job.mode === 'forward') {
    return telegram.forwardMessage(chatId, job.sourceChatId, job.sourceMessageId);
  }

  const replyMarkup = cloneReplyMarkup(job.sourceReplyMarkup);
  const extra = replyMarkup ? { reply_markup: replyMarkup } : {};
  return telegram.copyMessage(chatId, job.sourceChatId, job.sourceMessageId, extra);
}

async function deliverWithFloodWait(telegram, job, telegramId) {
  try {
    await copyOrForwardMessage(telegram, job, telegramId);
    return;
  } catch (error) {
    const retryAfter = getRetryAfterSeconds(error);
    if (retryAfter > 0) {
      await sleep((retryAfter + 2) * 1000);
      await copyOrForwardMessage(telegram, job, telegramId);
      return;
    }
    throw error;
  }
}

async function createDelivery(jobId, telegramId, status, error = null) {
  const now = new Date();
  await BroadcastDelivery.findOneAndUpdate(
    { jobId, telegramId },
    {
      $setOnInsert: { createdAt: now },
      $set: {
        status,
        errorCode: error ? getTelegramErrorCode(error) : '',
        errorMessage: error ? getTelegramErrorMessage(error) : '',
        sentAt: status === 'sent' ? now : null,
        updatedAt: now,
      },
    },
    { upsert: true, new: true }
  );
}

async function runBroadcastJob(telegram, jobId) {
  const jobKey = String(jobId);
  const runtime = { stopRequested: false };
  activeRuntimeJobs.set(jobKey, runtime);

  let job = await BroadcastJob.findById(jobId);
  if (!job) {
    activeRuntimeJobs.delete(jobKey);
    return;
  }

  try {
    job.status = 'active';
    job.startedAt = job.startedAt || new Date();
    job.updatedAt = new Date();
    await job.save();
    await safeEditStatus(telegram, job, 'စတင်ပို့နေပါပြီ...');

    const query = buildRecipientQuery(job);
    const cursor = User.find(query).sort({ telegramId: 1 }).lean().cursor();
    let processedSinceEdit = 0;

    for await (const user of cursor) {
      job = await BroadcastJob.findById(jobId);
      if (!job) break;
      if (runtime.stopRequested || job.stopRequested || job.status === 'stopping') {
        job.status = 'stopped';
        job.finishedAt = new Date();
        job.updatedAt = new Date();
        await job.save();
        await safeEditStatus(telegram, job, 'Admin က stop လုပ်ထားပါတယ်။');
        break;
      }

      const telegramId = Number(user.telegramId);
      if (!Number.isFinite(telegramId) || telegramId <= 0) {
        job.skippedCount += 1;
        await job.save();
        continue;
      }

      const existingDelivery = await BroadcastDelivery.findOne({ jobId: job._id, telegramId }).lean();
      if (existingDelivery?.status === 'sent') {
        job.skippedCount += 1;
        job.lastTelegramId = telegramId;
        job.updatedAt = new Date();
        await job.save();
        continue;
      }

      try {
        await deliverWithFloodWait(telegram, job, telegramId);
        await createDelivery(job._id, telegramId, 'sent');
        job.sentCount += 1;
      } catch (error) {
        await createDelivery(job._id, telegramId, 'failed', error);
        job.failedCount += 1;
      }

      job.lastTelegramId = telegramId;
      job.updatedAt = new Date();
      await job.save();

      processedSinceEdit += 1;
      if (processedSinceEdit >= BROADCAST_PROGRESS_EVERY) {
        processedSinceEdit = 0;
        await safeEditStatus(telegram, job, 'ပို့နေဆဲပါ...');
      }

      if (BROADCAST_DELAY_MS > 0) {
        await sleep(BROADCAST_DELAY_MS);
      }
    }

    job = await BroadcastJob.findById(jobId);
    if (job && job.status === 'active') {
      job.status = 'completed';
      job.finishedAt = new Date();
      job.updatedAt = new Date();
      await job.save();
      await safeEditStatus(telegram, job, 'Broadcast ပြီးပါပြီ။');
    }
  } catch (error) {
    job = await BroadcastJob.findById(jobId);
    if (job) {
      job.status = 'failed';
      job.finishedAt = new Date();
      job.updatedAt = new Date();
      job.errorMessage = getTelegramErrorMessage(error);
      await job.save();
      await safeEditStatus(telegram, job, `Error: ${job.errorMessage}`);
    }
    console.error('BROADCAST_JOB_ERROR:', error);
  } finally {
    activeRuntimeJobs.delete(jobKey);
  }
}

async function startBroadcast(ctx, bot) {
  const activeJob = await BroadcastJob.findOne({ status: { $in: ['queued', 'active', 'stopping'] } }).sort({ createdAt: -1 }).lean();
  if (activeJob) {
    await ctx.reply(`📢 Broadcast တစ်ခုလုပ်နေဆဲပါ။\nJob ID: ${activeJob._id}\n/stop_broadcast နဲ့ရပ်နိုင်ပါတယ်။`);
    return;
  }

  const repliedMessage = ctx.message?.reply_to_message;
  if (!repliedMessage?.message_id) {
    await ctx.reply([
      'အသုံးပြုပုံ - ပို့ချင်တဲ့ message ကို reply ပြီး /broadcast ရိုက်ပါ။',
      '',
      'Options:',
      '• /broadcast -clean  (button ပါ clean copy)',
      '• /broadcast - clean  (အပေါ်ကနဲ့အတူတူ)',
      '• /broadcast -copy  (default, clean copy)',
      '• /broadcast -forward  (forward header ပါနိုင်၊ button မပါနိုင်)',
      '• /broadcast -completed  (profile complete users only)',
      '• /broadcast -all  (banned users ပါထည့်မယ်)',
      '• /broadcast -no-buttons  (button မထည့်ချင်ရင်)',
    ].join('\n'));
    return;
  }

  const options = parseBroadcastArgs(ctx.message?.text || '');
  const query = buildRecipientQuery(options);
  const totalCount = await User.countDocuments(query);
  if (!totalCount) {
    await ctx.reply('ပို့ရန် user မရှိသေးပါ။');
    return;
  }

  const sourceReplyMarkup = options.keepButtons ? cloneReplyMarkup(repliedMessage.reply_markup) : null;
  const buttonCount = countInlineButtons(sourceReplyMarkup);

  const statusMsg = await ctx.reply([
    '📢 Broadcast job စတင်ပြင်ဆင်နေပါပြီ...',
    buttonCount > 0 ? `🔘 Inline buttons: ${buttonCount} ခုပါဝင်ပါမယ်။` : '🔘 Inline buttons: မပါပါ။',
  ].join('\n'));

  const job = await BroadcastJob.create({
    status: 'queued',
    adminId: Number(ctx.from.id),
    sourceChatId: Number(ctx.chat.id),
    sourceMessageId: Number(repliedMessage.message_id),
    sourceReplyMarkup,
    mode: options.mode,
    target: options.target,
    includeBanned: options.includeBanned,
    totalCount,
    statusChatId: Number(statusMsg.chat.id),
    statusMessageId: Number(statusMsg.message_id),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await safeEditStatus(
    ctx.telegram,
    job,
    buttonCount > 0
      ? `Queue ပြီးပါပြီ။ နောက်ခံမှာပို့နေပါမယ်။\n🔘 Inline buttons ${buttonCount} ခုကို clean copy ထဲမှာ ထည့်ပို့ပါမယ်။`
      : 'Queue ပြီးပါပြီ။ နောက်ခံမှာပို့နေပါမယ်။'
  );
  setImmediate(() => runBroadcastJob(bot.telegram, job._id));
}

async function stopBroadcast(ctx) {
  const jobs = await BroadcastJob.find({ status: { $in: ['queued', 'active', 'stopping'] } });
  if (!jobs.length) {
    await ctx.reply('Active broadcast မရှိပါ။');
    return;
  }

  for (const job of jobs) {
    job.status = 'stopping';
    job.stopRequested = true;
    job.updatedAt = new Date();
    await job.save();

    const runtime = activeRuntimeJobs.get(String(job._id));
    if (runtime) runtime.stopRequested = true;
  }

  await ctx.reply(`🛑 Broadcast stop request ပို့ပြီးပါပြီ။\nJobs: ${jobs.length}`);
}

async function showBroadcastStatus(ctx) {
  const job = await BroadcastJob.findOne({}).sort({ createdAt: -1 }).lean();
  if (!job) {
    await ctx.reply('Broadcast job history မရှိသေးပါ။');
    return;
  }
  await ctx.reply(buildBroadcastStatusText(job), { parse_mode: 'HTML' });
}

async function resumeBroadcast(ctx, bot) {
  const parts = String(ctx.message?.text || '').trim().split(/\s+/);
  const jobId = parts[1];
  if (!jobId) {
    await ctx.reply('အသုံးပြုပုံ - /broadcast_resume <jobId>');
    return;
  }

  const job = await BroadcastJob.findById(jobId);
  if (!job) {
    await ctx.reply('Job ID မတွေ့ပါ။');
    return;
  }

  if (['active', 'queued', 'stopping'].includes(job.status)) {
    await ctx.reply('ဒီ job က active ဖြစ်နေပါတယ်။');
    return;
  }

  job.status = 'queued';
  job.stopRequested = false;
  job.finishedAt = null;
  job.errorMessage = '';
  job.updatedAt = new Date();
  await job.save();

  await ctx.reply(`🔁 Broadcast resume စတင်ပါပြီ။\nJob ID: ${job._id}`);
  setImmediate(() => runBroadcastJob(bot.telegram, job._id));
}

module.exports = {
  parseBroadcastArgs,
  startBroadcast,
  stopBroadcast,
  showBroadcastStatus,
  resumeBroadcast,
  runBroadcastJob,
  buildBroadcastStatusText,
};
