const User = require('../models/User');
const Reaction = require('../models/Reaction');
const Report = require('../models/Report');
const { requirePrivateChat } = require('../middlewares/privateOnly');
const { mainMenuKeyboard } = require('../utils/keyboards');

async function deleteOwnProfile(ctx) {
  if (!(await requirePrivateChat(ctx))) return;

  const telegramId = Number(ctx.from.id);
  await Reaction.deleteMany({ $or: [{ fromUserId: telegramId }, { toUserId: telegramId }] });
  await Report.deleteMany({ $or: [{ reporterId: telegramId }, { targetUserId: telegramId }] });
  await User.findOneAndUpdate(
    { telegramId },
    {
      $set: {
        profileName: '',
        gender: '',
        relationshipStatus: '',
        age: 0,
        height: '',
        address: '',
        hobby: '',
        photoFileId: '',
        media: [],
        isProfileComplete: false,
        isHidden: false,
        reactions: { like: 0, love: 0, laugh: 0 },
        updatedAt: new Date(),
      },
    },
    { new: true }
  );

  await ctx.reply('🗑 သင့် profile data ကို ဖျက်ပြီးပါပြီ။', mainMenuKeyboard());
}

async function setHidden(ctx, hidden) {
  if (!(await requirePrivateChat(ctx))) return;

  const user = await User.findOne({ telegramId: Number(ctx.from.id) });
  if (!user || !user.isProfileComplete) {
    await ctx.reply('အရင်ဆုံး သင့် profile ကို ဖြည့်ပေးပါ။', mainMenuKeyboard());
    return;
  }

  user.isHidden = hidden;
  user.updatedAt = new Date();
  await user.save();

  await ctx.reply(hidden ? '🙈 သင့် profile ကို ဖျောက်ထားလိုက်ပါပြီ။' : '👁 သင့် profile ကို ပြန်ပြလိုက်ပါပြီ။', mainMenuKeyboard());
}

function registerPrivacyCommands(bot) {
  bot.command('privacy', async (ctx) => {
    if (!(await requirePrivateChat(ctx))) return;

    await ctx.reply(
      [
        '🔐 <b>Cupid Bot Privacy</b>',
        '',
        'Bot က သင်ဖြည့်ထားတဲ့ profile data ကို MongoDB ထဲမှာ သိမ်းထားပါတယ်။',
        'သိမ်းထားနိုင်တဲ့ data များ - နာမည်၊ လိင်၊ လက်ရှိအခြေအနေ၊ အသက်၊ အရပ်၊ နေရပ်လိပ်စာ၊ ဝါသနာ၊ Telegram username နှင့် profile photo/video file id + backup channel message id။',
        '',
        'အသုံးဝင်သော command များ:',
        '• /hide - profile ကို list ထဲက ဖျောက်ရန်',
        '• /show - profile ကို ပြန်ပြရန်',
        '• /delete_my_profile - profile data ကို ဖျက်ရန်',
      ].join('\n'),
      { parse_mode: 'HTML', reply_markup: mainMenuKeyboard().reply_markup }
    );
  });

  bot.command('delete_my_profile', deleteOwnProfile);
  bot.command('hide', async (ctx) => setHidden(ctx, true));
  bot.command('show', async (ctx) => setHidden(ctx, false));
}

module.exports = {
  registerPrivacyCommands,
};
