const { Markup } = require('telegraf');
const { escapeHtml } = require('./escapeHtml');

const BUTTON_STYLE = Object.freeze({
  PRIMARY: 'primary',
  SUCCESS: 'success',
  DANGER: 'danger',
});

function normalizeStyle(style = BUTTON_STYLE.PRIMARY) {
  return Object.values(BUTTON_STYLE).includes(style) ? style : BUTTON_STYLE.PRIMARY;
}

function callbackButton(text, callbackData, style = BUTTON_STYLE.PRIMARY) {
  return {
    text,
    callback_data: callbackData,
    style: normalizeStyle(style),
  };
}

function urlButton(text, url, style = BUTTON_STYLE.PRIMARY) {
  return {
    text,
    url,
    style: normalizeStyle(style),
  };
}

function replyButton(text, style = BUTTON_STYLE.PRIMARY) {
  return {
    text,
    style: normalizeStyle(style),
  };
}

function inlineKeyboard(rows) {
  return Markup.inlineKeyboard(rows);
}

function replyKeyboard(rows, options = {}) {
  let keyboard = Markup.keyboard(rows);

  if (options.resize !== false) keyboard = keyboard.resize();
  if (options.oneTime) keyboard = keyboard.oneTime();

  return keyboard;
}

function mainMenuKeyboard() {
  return replyKeyboard([
    [
      replyButton('📝 Profile ဖြည့်ရန်', BUTTON_STYLE.SUCCESS),
      replyButton('👤 ကျွန်ုပ်၏ Profile', BUTTON_STYLE.PRIMARY),
    ],
    [
      replyButton('👧 Girls List', BUTTON_STYLE.PRIMARY),
      replyButton('👦 Boys List', BUTTON_STYLE.PRIMARY),
    ],
    [
      replyButton('✏️ Profile ပြင်ရန်', BUTTON_STYLE.PRIMARY),
      replyButton('🖼 ပုံထည့်/ပြင်မယ်', BUTTON_STYLE.SUCCESS),
    ],
    [replyButton('🎲 ကျပန်း Profile ကြည့်ရန်', BUTTON_STYLE.PRIMARY), replyButton('ℹ️ အကူအညီ', BUTTON_STYLE.PRIMARY)],
  ]);
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
    `🖼 <b>Media:</b> ${Array.isArray(user.media) && user.media.length ? user.media.length : (user.photoFileId ? 1 : 0)}/3`,
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
      callbackButton(`👍 ${user.reactions?.like || 0}`, `rx:like:${user.telegramId}:${gender}:${index}`, BUTTON_STYLE.PRIMARY),
      callbackButton(`❤ ${user.reactions?.love || 0}`, `rx:love:${user.telegramId}:${gender}:${index}`, BUTTON_STYLE.SUCCESS),
      callbackButton(`🤣 ${user.reactions?.laugh || 0}`, `rx:laugh:${user.telegramId}:${gender}:${index}`, BUTTON_STYLE.PRIMARY),
    ],
    [urlButton('👤 Telegram Account ဖွင့်ရန်', profileOpenUrl(user), BUTTON_STYLE.PRIMARY)],
    [callbackButton('🚨 Report', `report:${user.telegramId}:${gender}:${index}`, BUTTON_STYLE.DANGER)],
    [
      callbackButton('⬅️ Back', `nav:${gender}:${prevIndex}`, BUTTON_STYLE.PRIMARY),
      callbackButton('➡️ Next', `nav:${gender}:${nextIndex}`, BUTTON_STYLE.PRIMARY),
    ],
    [callbackButton('🏠 Main Menu', 'main:menu', BUTTON_STYLE.PRIMARY)],
  ];

  if (isAdminView) {
    rows.splice(3, 0, [
      callbackButton('🚫 Ban', `adminban:${user.telegramId}`, BUTTON_STYLE.DANGER),
      callbackButton('🗑 Delete', `admindel:${user.telegramId}`, BUTTON_STYLE.DANGER),
    ]);
  }

  return inlineKeyboard(rows);
}

module.exports = {
  BUTTON_STYLE,
  callbackButton,
  urlButton,
  replyButton,
  inlineKeyboard,
  replyKeyboard,
  mainMenuKeyboard,
  profileOpenUrl,
  genderLabel,
  reactionEmoji,
  buildProfileCaption,
  buildProfileButtons,
};
