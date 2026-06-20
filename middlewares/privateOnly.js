const { BUTTON_STYLE, inlineKeyboard, urlButton } = require('../utils/keyboards');

function isPrivateChat(ctx) {
  return ctx.chat?.type === 'private';
}

async function askToUseDm(ctx) {
  const botUsername = ctx.botInfo?.username;
  const buttons = botUsername
    ? inlineKeyboard([[urlButton('💬 Bot DM ဖွင့်ရန်', `https://t.me/${botUsername}?start=main`, BUTTON_STYLE.PRIMARY)]])
    : undefined;

  await ctx.reply('ဒီ feature ကို Bot DM ထဲမှာပဲ အသုံးပြုနိုင်ပါတယ်။', buttons);
}

async function requirePrivateChat(ctx) {
  if (isPrivateChat(ctx)) return true;

  try {
    if (ctx.updateType === 'callback_query') {
      await ctx.answerCbQuery('DM ထဲမှာပဲ အသုံးပြုနိုင်ပါတယ်။', { show_alert: true });
    } else {
      await askToUseDm(ctx);
    }
  } catch (_) {}

  return false;
}

function privateOnly() {
  return async (ctx, next) => {
    if (!(await requirePrivateChat(ctx))) return;
    return next();
  };
}

module.exports = {
  isPrivateChat,
  requirePrivateChat,
  privateOnly,
};
