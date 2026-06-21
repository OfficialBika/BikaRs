const { Markup } = require('telegraf');
const { escapeHtml } = require('./escapeHtml');


const PREMIUM_EMOJI = Object.freeze({
  diamond: '<tg-emoji emoji-id="5262922516426420894">💍</tg-emoji>',
  crown: '<tg-emoji emoji-id="5251371708689962992">👑</tg-emoji>',
  hourglass: '<tg-emoji emoji-id="5206356981094310220">⏳</tg-emoji>',
  profileId: '<tg-emoji emoji-id="4907231385309152742">🪪</tg-emoji>',
  user: '<tg-emoji emoji-id="4967667085606912536">👤</tg-emoji>',
  gender: '<tg-emoji emoji-id="5055708439091610281">🔞</tg-emoji>',
  status: '<tg-emoji emoji-id="5296489485435951892">💕</tg-emoji>',
  age: '<tg-emoji emoji-id="5452055425690123301">🎂</tg-emoji>',
  height: '<tg-emoji emoji-id="5195031173809594981">🤩</tg-emoji>',
  location: '<tg-emoji emoji-id="5258134950741289943">📍</tg-emoji>',
  hobby: '<tg-emoji emoji-id="5368516271673471902">🎁</tg-emoji>',
  username: '<tg-emoji emoji-id="5470153563176990018">❤️</tg-emoji>',
  media: '<tg-emoji emoji-id="5033108527338488459">🖼</tg-emoji>',
});

function premiumEmoji(key, fallback, isPremium = true) {
  return isPremium ? (PREMIUM_EMOJI[key] || fallback || '') : (fallback || '');
}

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

function formatPremiumDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toISOString().slice(0, 10);
}

function buildProfileCaption(user, index, total) {
  const isPremium = Boolean(user.premium?.isActive);
  const icon = (key, fallback) => premiumEmoji(key, fallback, isPremium);
  const header = isPremium
    ? `${icon('diamond', '💎')} <b>Premium Cupid Profile</b>`
    : '💘 <b>Cupid Profile</b>';
  const premiumLines = isPremium
    ? [
        `${icon('crown', '👑')} <b>Premium User</b>`,
        `${icon('hourglass', '⏳')} <b>Premium Until:</b> <code>${escapeHtml(formatPremiumDate(user.premium?.expiresAt))}</code>`,
        '',
      ]
    : [];

  return [
    header,
    ...premiumLines,
    `${icon('profileId', '🆔')} <b>Profile ID:</b> <code>${escapeHtml(user.profileId || '-')}</code>`,
    `${icon('user', '👤')} <b>နာမည်:</b> ${escapeHtml(user.profileName || '-')}`,
    `${icon('gender', '⚧')} <b>လိင်:</b> ${escapeHtml(genderLabel(user.gender))}`,
    `${icon('status', '💞')} <b>လက်ရှိအခြေအနေ:</b> ${escapeHtml(user.relationshipStatus || '-')}`,
    `${icon('age', '🎂')} <b>အသက်:</b> ${escapeHtml(user.age || '-')}`,
    `${icon('height', '📏')} <b>အရပ်အမြင့်:</b> ${escapeHtml(user.height || '-')}`,
    `${icon('location', '📍')} <b>နေရပ်လိပ်စာ:</b> ${escapeHtml(user.address || '-')}`,
    `${icon('hobby', '🎯')} <b>ဝါသနာ:</b> ${escapeHtml(user.hobby || '-')}`,
    `${icon('username', '🆔')} <b>Username:</b> ${user.username ? `@${escapeHtml(user.username)}` : 'မရှိသေးပါ'}`,
    `${icon('media', '🖼')} <b>Media:</b> ${Array.isArray(user.media) && user.media.length ? user.media.length : (user.photoFileId ? 1 : 0)}/3`,
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
    [urlButton('💬Dm စကားပြောမယ်', profileOpenUrl(user), BUTTON_STYLE.PRIMARY)],
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


function buildDirectProfileButtons(user) {
  const rows = [
    [
      callbackButton(`👍 ${user.reactions?.like || 0}`, `rxcheck:like:${user.telegramId}`, BUTTON_STYLE.PRIMARY),
      callbackButton(`❤ ${user.reactions?.love || 0}`, `rxcheck:love:${user.telegramId}`, BUTTON_STYLE.SUCCESS),
      callbackButton(`🤣 ${user.reactions?.laugh || 0}`, `rxcheck:laugh:${user.telegramId}`, BUTTON_STYLE.PRIMARY),
    ],
    [urlButton('💬Dm စကားပြောမယ်', profileOpenUrl(user), BUTTON_STYLE.PRIMARY)],
    [callbackButton('🚨 Report', `reportcheck:${user.telegramId}`, BUTTON_STYLE.DANGER)],
    [callbackButton('🏠 Main Menu', 'main:menu', BUTTON_STYLE.PRIMARY)],
  ];

  return inlineKeyboard(rows);
}

module.exports = {
  BUTTON_STYLE,
  PREMIUM_EMOJI,
  premiumEmoji,
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
  buildDirectProfileButtons,
};
