const { mainMenuKeyboard } = require('../utils/keyboards');

async function sendHelp(ctx) {
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
      '• /broadcast (your message)',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard().reply_markup,
    }
  );
}

function registerStartCommands(bot) {
  bot.start(async (ctx) => {
    await ctx.reply(
      '💘 Cupid Bot မှ ကြိုဆိုပါသည်။\n\nသင့် profile ကို ဖြည့်ပြီး photo/video 1-3 ခုထည့်နိုင်ပါတယ်။ တခြား user များ၏ profile ကိုလည်း ကြည့်ရှုနိုင်ပါသည်။',
      mainMenuKeyboard()
    );
  });

  bot.command('help', sendHelp);
  bot.hears('ℹ️ အကူအညီ', sendHelp);
}

module.exports = {
  registerStartCommands,
  sendHelp,
};
