const express = require('express');
const mongoose = require('mongoose');
const { Telegraf, session } = require('telegraf');

const {
  BOT_TOKEN,
  MONGODB_URI,
  WEBHOOK_URL,
  PORT,
  validateEnv,
} = require('./config/env');
const { authMiddleware } = require('./middlewares/auth');
const { requirePrivateChat } = require('./middlewares/privateOnly');
const { requiredMembershipMiddleware, requireSupportMembership } = require('./middlewares/requiredMembership');
const { mainMenuKeyboard } = require('./utils/keyboards');
const { registerStartCommands } = require('./commands/start');
const {
  registerProfileCommands,
  profileSessionMiddleware,
} = require('./commands/profile');
const { registerMatchCommands } = require('./commands/match');
const { registerPrivacyCommands } = require('./commands/privacy');
const { registerAdminCommands } = require('./commands/admin');
const { backfillProfileIds } = require('./utils/profileIds');

validateEnv();

const bot = new Telegraf(BOT_TOKEN);
const app = express();

mongoose.set('strictQuery', true);

bot.use(session());
bot.use(profileSessionMiddleware);
bot.use(authMiddleware);
bot.use(requiredMembershipMiddleware());

registerStartCommands(bot);
registerProfileCommands(bot);
registerMatchCommands(bot);
registerPrivacyCommands(bot);
registerAdminCommands(bot);

bot.action('main:menu', async (ctx) => {
  if (!(await requirePrivateChat(ctx))) return;
  if (!(await requireSupportMembership(ctx))) return;

  await ctx.answerCbQuery();
  try {
    await ctx.deleteMessage();
  } catch (_) {}
  await ctx.reply('🏠 Main Menu', mainMenuKeyboard());
});

bot.catch(async (err, ctx) => {
  console.error('BOT_ERROR:', err);
  try {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('❌ Error တစ်ခု ဖြစ်သွားပါတယ်။ ခဏနေရင် ပြန်စမ်းကြည့်ပါ။', mainMenuKeyboard());
    } else {
      await ctx.reply('❌ Error တစ်ခု ဖြစ်သွားပါတယ်။ ခဏနေရင် ပြန်စမ်းကြည့်ပါ။');
    }
  } catch (_) {}
});

app.get('/', (_req, res) => {
  res.status(200).send('Cupid bot is running');
});

app.use(bot.webhookCallback('/webhook'));

(async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    await backfillProfileIds();
    await bot.telegram.setWebhook(`${WEBHOOK_URL.replace(/\/$/, '')}/webhook`);

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log('Webhook bot started');
    });
  } catch (error) {
    console.error('STARTUP_ERROR:', error);
    process.exit(1);
  }
})();
