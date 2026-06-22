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


function charLen(value) {
  return [...String(value || '')].length;
}

function truncateText(value, max = 22) {
  const text = String(value ?? '-')
    .replace(/\s+/g, ' ')
    .trim() || '-';

  if (charLen(text) <= max) return text;
  return [...text].slice(0, Math.max(1, max - 1)).join('') + '…';
}

function padText(value, width) {
  const text = truncateText(value, width);
  const len = charLen(text);
  return len >= width ? text : `${text}${' '.repeat(width - len)}`;
}

function buildPremiumInfoTable(rows = []) {
  const labelWidth = 12;
  const valueWidth = 22;
  const top = `┌${'─'.repeat(labelWidth + 2)}┬${'─'.repeat(valueWidth + 2)}┐`;
  const bottom = `└${'─'.repeat(labelWidth + 2)}┴${'─'.repeat(valueWidth + 2)}┘`;
  const body = rows.map(([label, value]) => `│ ${padText(label, labelWidth)} │ ${padText(value, valueWidth)} │`);
  return [top, ...body, bottom].join('\n');
}

function premiumTableUsername(user = {}) {
  return user.username ? `@${user.username}` : '-';
}

function buildPremiumProfileCaption(user, options = {}) {
  const mediaCount = Number.isFinite(Number(options.mediaCount))
    ? Number(options.mediaCount)
    : (Array.isArray(user.media) && user.media.length ? user.media.length : (user.photoFileId ? 1 : 0));
  const title = options.title || 'PREMIUM CUPID PROFILE';
  const until = formatPremiumDate(user.premium?.expiresAt);
  const table = buildPremiumInfoTable([
    ['Status', 'Premium User'],
    ['Until', until],
    ['Profile ID', user.profileId || '-'],
    ['Name', user.profileName || '-'],
    ['Gender', genderLabel(user.gender)],
    ['Relation', user.relationshipStatus || '-'],
    ['Age', user.age || '-'],
    ['Height', user.height || '-'],
    ['Address', user.address || '-'],
    ['Hobby', user.hobby || '-'],
    ['Username', premiumTableUsername(user)],
    ['Media', `${mediaCount}/${3}`],
  ]);

  const lines = [
    `${premiumEmoji('diamond', '💎', true)} <b>${escapeHtml(title)}</b>`,
    `${premiumEmoji('crown', '👑', true)} <b>Premium User</b>   ${premiumEmoji('hourglass', '⏳', true)} <code>${escapeHtml(until)}</code>`,
    '',
    `<pre>${escapeHtml(table)}</pre>`,
    '',
    `👍 ${user.reactions?.like || 0}   ❤ ${user.reactions?.love || 0}   🤣 ${user.reactions?.laugh || 0}`,
  ];

  if (options.includePagination) {
    const index = Number(options.index || 0);
    const total = Number(options.total || 0);
    lines.push('', `📄 <b>${total > 0 ? index + 1 : 0}/${total}</b>`);
  }

  return lines.join('\n');
}


function richCell(value) {
  return String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRichTableRow(labelHtml, valueHtml) {
  return `<tr><td><b>${labelHtml}</b></td><td>${valueHtml}</td></tr>`;
}

function buildPremiumProfileRichHtml(user, options = {}) {
  const mediaCount = Number.isFinite(Number(options.mediaCount))
    ? Number(options.mediaCount)
    : (Array.isArray(user.media) && user.media.length ? user.media.length : (user.photoFileId ? 1 : 0));
  const title = options.title || 'PREMIUM CUPID PROFILE';
  const until = formatPremiumDate(user.premium?.expiresAt);
  const includePagination = Boolean(options.includePagination);
  const index = Number(options.index || 0);
  const total = Number(options.total || 0);

  const rows = [
    [premiumEmoji('crown', '👑', true) + ' Status', '<b>Premium User</b>'],
    [premiumEmoji('hourglass', '⏳', true) + ' Premium Until', `<code>${richCell(until)}</code>`],
    [premiumEmoji('profileId', '🪪', true) + ' Profile ID', `<code>${richCell(user.profileId || '-')}</code>`],
    [premiumEmoji('user', '👤', true) + ' Name', richCell(user.profileName || '-')],
    [premiumEmoji('gender', '🔞', true) + ' Gender', richCell(genderLabel(user.gender))],
    [premiumEmoji('status', '💕', true) + ' Relationship', richCell(user.relationshipStatus || '-')],
    [premiumEmoji('age', '🎂', true) + ' Age', richCell(user.age || '-')],
    [premiumEmoji('height', '🤩', true) + ' Height', richCell(user.height || '-')],
    [premiumEmoji('location', '📍', true) + ' Address', richCell(user.address || '-')],
    [premiumEmoji('hobby', '🎁', true) + ' Hobby', richCell(user.hobby || '-')],
    [premiumEmoji('username', '❤️', true) + ' Username', user.username ? `<code>@${richCell(user.username)}</code>` : '-'],
    [premiumEmoji('media', '🖼', true) + ' Media', `<b>${richCell(`${mediaCount}/${3}`)}</b>`],
  ];

  const tableRows = rows.map(([label, value]) => buildRichTableRow(label, value)).join('');
  const pageLine = includePagination
    ? `<p>📄 <b>${total > 0 ? index + 1 : 0}/${total}</b></p>`
    : '';

  return [
    `<h3>${premiumEmoji('diamond', '💎', true)} ${richCell(title)}</h3>`,
    `<blockquote>${premiumEmoji('crown', '👑', true)} <b>Premium User</b> ${premiumEmoji('hourglass', '⏳', true)} <code>${richCell(until)}</code></blockquote>`,
    `<table bordered striped><caption>${premiumEmoji('diamond', '💎', true)} Premium Profile Info</caption><tr><th>Field</th><th>Value</th></tr>${tableRows}</table>`,
    `<p>👍 <b>${richCell(user.reactions?.like || 0)}</b> &nbsp; ❤ <b>${richCell(user.reactions?.love || 0)}</b> &nbsp; 🤣 <b>${richCell(user.reactions?.laugh || 0)}</b></p>`,
    pageLine,
  ].filter(Boolean).join('\n');
}

function buildProfileCaption(user, index, total) {
  const isPremium = Boolean(user.premium?.isActive);
  if (isPremium) {
    return buildPremiumProfileCaption(user, {
      title: 'PREMIUM CUPID PROFILE',
      index,
      total,
      includePagination: true,
    });
  }

  return [
    '💘 <b>Cupid Profile</b>',
    `${premiumEmoji('profileId', '🆔', false)} <b>Profile ID:</b> <code>${escapeHtml(user.profileId || '-')}</code>`,
    `${premiumEmoji('user', '👤', false)} <b>နာမည်:</b> ${escapeHtml(user.profileName || '-')}`,
    `${premiumEmoji('gender', '⚧', false)} <b>လိင်:</b> ${escapeHtml(genderLabel(user.gender))}`,
    `${premiumEmoji('status', '💞', false)} <b>လက်ရှိအခြေအနေ:</b> ${escapeHtml(user.relationshipStatus || '-')}`,
    `${premiumEmoji('age', '🎂', false)} <b>အသက်:</b> ${escapeHtml(user.age || '-')}`,
    `${premiumEmoji('height', '📏', false)} <b>အရပ်အမြင့်:</b> ${escapeHtml(user.height || '-')}`,
    `${premiumEmoji('location', '📍', false)} <b>နေရပ်လိပ်စာ:</b> ${escapeHtml(user.address || '-')}`,
    `${premiumEmoji('hobby', '🎯', false)} <b>ဝါသနာ:</b> ${escapeHtml(user.hobby || '-')}`,
    `${premiumEmoji('username', '🆔', false)} <b>Username:</b> ${user.username ? `@${escapeHtml(user.username)}` : 'မရှိသေးပါ'}`,
    `${premiumEmoji('media', '🖼', false)} <b>Media:</b> ${Array.isArray(user.media) && user.media.length ? user.media.length : (user.photoFileId ? 1 : 0)}/3`,
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


function buildDirectProfileButtons(user) {
  const rows = [
    [
      callbackButton(`👍 ${user.reactions?.like || 0}`, `rxcheck:like:${user.telegramId}`, BUTTON_STYLE.PRIMARY),
      callbackButton(`❤ ${user.reactions?.love || 0}`, `rxcheck:love:${user.telegramId}`, BUTTON_STYLE.SUCCESS),
      callbackButton(`🤣 ${user.reactions?.laugh || 0}`, `rxcheck:laugh:${user.telegramId}`, BUTTON_STYLE.PRIMARY),
    ],
    [urlButton('👤 Telegram Account ဖွင့်ရန်', profileOpenUrl(user), BUTTON_STYLE.PRIMARY)],
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
  formatPremiumDate,
  buildPremiumInfoTable,
  buildPremiumProfileCaption,
  buildPremiumProfileRichHtml,
  buildProfileCaption,
  buildProfileButtons,
  buildDirectProfileButtons,
};
