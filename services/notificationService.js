async function sendReactionNotification(bot, userId, emoji, count) {
  try {
    await bot.telegram.sendMessage(
      userId,
      `သင့် profile တွင် ${emoji} reaction အသစ်တစ်ခု ရရှိထားပါသည်။\nစုစုပေါင်း ${emoji} : ${count}`
    );
  } catch (error) {
    console.error('Notification error:', error.message);
  }
}

module.exports = { sendReactionNotification };
