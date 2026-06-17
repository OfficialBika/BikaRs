const { Markup } = require('telegraf');
const { escapeHtml } = require('./escapeHtml');

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['📝 Profile ဖြည့်ရန်', '👤 ကျွန်ုပ်၏ Profile'],
    ['👧 Girls List', '👦 Boys List'],
    ['✏️ Profile ပြင်ရန်', '🎲 ကျပန်း Profile ကြည့်ရန်'],
    ['ℹ️ အကူအညီ'],
  ]).resize();
}

function profileOpenUrl(user) {
  if (user.username) return `https://t.me/${user.username}`;
  return `tg://user?id=${user.telegramId}`;
}

function genderLabel(value) {
  if (value === 'male') return 'ကျား';
  if (value === 'female') return 'မ';
  return '-';
}

function reactionEmoji(type) {
  if (type === 'like') return '👍';
  if (type === 'love') return '❤';
  if (type === 'laugh') return '🤣';
  return '•';
}

function buildProfileCaption(user, index, total) {
  return [
    '💘 <b>Cupid Profile</b>',
    '',
    `👤 <b>နာမည်:</b> ${escapeHtml(user.profileName || '-')}`,
    `⚧ <b>လိင်:</b> ${escapeHtml(genderLabel(user.gender))}`,
    `💞 <b>လက်ရှိအခြေအနေ:</b> ${escapeHtml(user.relationshipStatus || '-')}`,
    `🎂 <b>အသက်:</b> ${escapeHtml(user.age || '-')}`,
    `📏 <b>အရပ်အမြင့်:</b> ${escapeHtml(user.height || '-')}`,
    `📍 <b>နေရပ်လိပ်စာ:</b> ${escapeHtml(user.address || '-')}`,
    `🎯 <b>ဝါသနာ:</b> ${escapeHtml(user.hobby || '-')}`,
    `🆔 <b>Username:</b> ${user.username ? `@${escapeHtml(user.username)}` : 'မရှိသေးပါ'}`,
    '',
    `👍 ${user.reactions?.like || 0}   ❤ ${user.reactions?.love || 0}   🤣 ${user.reactions?.laugh || 0}`,
    '',
    `📄 <b>${total > 0 ? index + 1 : 0}/${total}</b>`,
  ].join('\n');
}

function buildProfileButtons(user, gender, index, total, isAdminView = false) {
  const prevIndex = total > 0 ? (index - 1 + total) % total : 0;
  const nextIndex = total > 0 ? (index + 1) % total : 0;

  const rows = [
    [
      Markup.button.callback(`👍 ${user.reactions?.like || 0}`, `rx:like:${user.telegramId}:${gender}:${index}`),
      Markup.button.callback(`❤ ${user.reactions?.love || 0}`, `rx:love:${user.telegramId}:${gender}:${index}`),
      Markup.button.callback(`🤣 ${user.reactions?.laugh || 0}`, `rx:laugh:${user.telegramId}:${gender}:${index}`),
    ],
    [Markup.button.url('👤 Telegram Account ဖွင့်ရန်', profileOpenUrl(user))],
    [Markup.button.callback('🚨 Report', `report:${user.telegramId}:${gender}:${index}`)],
    [
      Markup.button.callback('⬅️ Back', `nav:${gender}:${prevIndex}`),
      Markup.button.callback('➡️ Next', `nav:${gender}:${nextIndex}`),
    ],
    [Markup.button.callback('🏠 Main Menu', 'main:menu')],
  ];

  if (isAdminView) {
    rows.splice(3, 0, [
      Markup.button.callback('🚫 Ban', `adminban:${user.telegramId}`),
      Markup.button.callback('🗑 Delete', `admindel:${user.telegramId}`),
    ]);
  }

  return Markup.inlineKeyboard(rows);
}

module.exports = {
  mainMenuKeyboard,
  profileOpenUrl,
  genderLabel,
  reactionEmoji,
  buildProfileCaption,
  buildProfileButtons,
};
