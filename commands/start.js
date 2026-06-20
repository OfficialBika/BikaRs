const { Markup } = require('telegraf');
const {
  SUPPORT_CHANNEL_ID,
  SUPPORT_GROUP_ID,
  SUPPORT_CHANNEL_URL,
  SUPPORT_GROUP_URL,
} = require('../config/env');
const { isPrivateChat, requirePrivateChat } = require('../middlewares/privateOnly');
const { requireSupportMembership } = require('../middlewares/requiredMembership');
const {
  BUTTON_STYLE,
  callbackButton,
  urlButton,
  inlineKeyboard,
  mainMenuKeyboard,
} = require('../utils/keyboards');

function startText() {
  return [
    '💘 <b>Cupid Bot မှ ကြိုဆိုပါသည်။</b>',
    '',
    'ဒီ bot မှာ ကိုယ့် profile ဖြည့်ပြီး photo/video 1-3 ခုထည့်နိုင်ပါတယ်။',
    'တခြား user များ၏ profile ကိုလည်း ကြည့်ရှုနိုင်ပါသည်။',
    '',
    'အသုံးပြုရန် Support Group နှင့် Support Channel ကို join ထားရပါမယ်။',
    'Join ပြီးမှ <b>Main Menu</b> ကိုနှိပ်ပြီး စတင်အသုံးပြုပါ။',
  ].join('\n');
}

function startKeyboard() {
  const groupButton = SUPPORT_GROUP_URL
    ? urlButton('👥 Support Group', SUPPORT_GROUP_URL, BUTTON_STYLE.PRIMARY)
    : callbackButton('👥 Support Group', 'support:group', BUTTON_STYLE.PRIMARY);

  const channelButton = SUPPORT_CHANNEL_URL
    ? urlButton('📢 Support Channel', SUPPORT_CHANNEL_URL, BUTTON_STYLE.PRIMARY)
    : callbackButton('📢 Support Channel', 'support:channel', BUTTON_STYLE.PRIMARY);

  return inlineKeyboard([
    [groupButton, channelButton],
    [callbackButton('🏠 Main Menu', 'main:menu', BUTTON_STYLE.SUCCESS)],
  ]);
}

function dmOnlyKeyboard(ctx) {
  const botUsername = ctx.botInfo?.username;
  if (!botUsername) return undefined;
  return inlineKeyboard([[urlButton('💬 Bot DM ဖွင့်ရန်', `https://t.me/${botUsername}`, BUTTON_STYLE.PRIMARY)]]);
}

async function sendGroupDmOnlyNotice(ctx) {
  const keyboard = dmOnlyKeyboard(ctx);
  await ctx.reply('💘 Cupid Bot menu ကို DM ထဲမှာပဲ အသုံးပြုနိုင်ပါတယ်။', keyboard ? {
    reply_markup: keyboard.reply_markup,
  } : undefined);
}

async function sendHelp(ctx) {
  if (!(await requirePrivateChat(ctx))) return;
  if (!(await requireSupportMembership(ctx))) return;

  await ctx.reply(
    [
      'ℹ️ <b>အကူအညီ</b>',
      '',
      '• 📝 Profile ဖြည့်ရန် - သင့် profile အသစ်ပြုလုပ်ရန်',
      '• 👧 Girls List / 👦 Boys List - တခြား user profile များကြည့်ရန်',
      '• 👤 ကျွန်ုပ်၏ Profile - ကိုယ့် profile ကြည့်ရန်',
      '• ✏️ Profile ပြင်ရန် - ကိုယ့် profile ပြင်ဆင်ရန်',
      '• 🖼 ပုံထည့်/ပြင်မယ် - profile photo/video ထပ်ထည့်ရန် သို့မဟုတ် အစားထိုးရန်',
      '• 🎲 ကျပန်း Profile ကြည့်ရန် - random profile ကြည့်ရန်',
      '• /check <profileId> - Profile ID နဲ့ profile ကြည့်ရန်',
      '',
      'Privacy Commands:',
      '• /privacy - Privacy အချက်အလက်ကြည့်ရန်',
      '• /delete_my_profile - ကိုယ့် profile ဖျက်ရန်',
      '• /hide - ကိုယ့် profile ဖျောက်ရန်',
      '• /show - ကိုယ့် profile ပြန်ပြရန်',
      '',
      'Admin Commands:',
      '• /admin - Admin panel ဖွင့်ရန်',
      '• /ban (telegramId)',
      '• /unban (telegramId)',
      '• /deleteprofile (telegramId)',
      '• /broadcast (reply message)',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard().reply_markup,
    }
  );
}

function supportInfo(type) {
  if (type === 'channel') {
    return {
      title: '📢 Support Channel',
      chatId: SUPPORT_CHANNEL_ID,
      envUrl: SUPPORT_CHANNEL_URL,
      buttonText: '📢 Open Support Channel',
    };
  }

  return {
    title: '👥 Support Group',
    chatId: SUPPORT_GROUP_ID,
    envUrl: SUPPORT_GROUP_URL,
    buttonText: '👥 Open Support Group',
  };
}

async function getSupportInviteLink(ctx, type) {
  const info = supportInfo(type);
  if (info.envUrl) return info.envUrl;

  const invite = await ctx.telegram.createChatInviteLink(info.chatId, {
    name: `Cupid Bot ${type} invite`,
    creates_join_request: false,
  });

  return invite.invite_link;
}

async function openSupport(ctx, type) {
  const info = supportInfo(type);
  await ctx.answerCbQuery().catch(() => {});

  try {
    const inviteLink = await getSupportInviteLink(ctx, type);
    await ctx.reply(`${info.title} ကိုဖွင့်ရန် အောက်က button ကိုနှိပ်ပါ။`, {
      reply_markup: inlineKeyboard([
        [urlButton(info.buttonText, inviteLink, BUTTON_STYLE.PRIMARY)],
      ]).reply_markup,
    });
  } catch (error) {
    console.error('SUPPORT_INVITE_ERROR:', error);
    await ctx.reply(
      [
        `❌ ${info.title} link ဖွင့်လို့မရသေးပါ။`,
        '',
        'Bot ကို support group/channel ထဲမှာ admin ထားပြီး Invite Users permission ပေးပါ။',
        'သို့မဟုတ် .env ထဲမှာ SUPPORT_GROUP_URL / SUPPORT_CHANNEL_URL ကို invite link နဲ့ ထည့်နိုင်ပါတယ်။',
      ].join('\n')
    );
  }
}

async function clearReplyKeyboard(ctx) {
  try {
    const msg = await ctx.reply('⌛', Markup.removeKeyboard());
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
    } catch (_) {}
  } catch (_) {}
}

function registerStartCommands(bot) {
  bot.start(async (ctx) => {
    await clearReplyKeyboard(ctx);

    if (!isPrivateChat(ctx)) {
      await sendGroupDmOnlyNotice(ctx);
      return;
    }

    await ctx.reply(startText(), {
      parse_mode: 'HTML',
      reply_markup: startKeyboard().reply_markup,
    });
  });

  bot.action('support:group', async (ctx) => openSupport(ctx, 'group'));
  bot.action('support:channel', async (ctx) => openSupport(ctx, 'channel'));

  bot.action('membership:check', async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;
    const ok = await requireSupportMembership(ctx);
    if (!ok) return;

    await ctx.answerCbQuery('✅ Join စစ်ဆေးမှုအောင်မြင်ပါပြီ။');
    try {
      await ctx.deleteMessage();
    } catch (_) {}
    await ctx.reply('✅ Support Group + Channel join ထားပြီးပါပြီ။\n🏠 Main Menu ကိုဖွင့်ပါ။', mainMenuKeyboard());
  });

  bot.command('help', sendHelp);
  bot.hears('ℹ️ အကူအညီ', sendHelp);
}

module.exports = {
  registerStartCommands,
  sendHelp,
  startKeyboard,
};
