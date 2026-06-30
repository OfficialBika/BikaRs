const User = require('../models/User');
const PremiumUser = require('../models/PremiumUser');
const OFFICIAL_BIKA_PREMIUM_OWNER_ID = 8251006975;

function isPremiumOwner(id) {
  const userId = Number(id);
  return Number.isFinite(userId) && userId === OFFICIAL_BIKA_PREMIUM_OWNER_ID;
}

function normalizeUsername(value = '') {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePremiumDuration(input = '') {
  const raw = String(input || '').trim().toLowerCase();
  const match = raw.match(/^(\d+)\s*(d|day|days)?$/i);
  if (!match) return null;

  const days = Number(match[1]);
  if (!Number.isInteger(days) || days <= 0 || days > 3650) return null;
  return days;
}

function premiumExpiresAt(days, from = new Date()) {
  return new Date(from.getTime() + Number(days) * 24 * 60 * 60 * 1000);
}

function isPremiumRecordActive(record, now = new Date()) {
  if (!record || record.isActive === false) return false;
  const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null;
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

function buildPremiumMeta(record) {
  if (!isPremiumRecordActive(record)) {
    return { isActive: false, expiresAt: null, durationDays: 0 };
  }

  return {
    isActive: true,
    expiresAt: record.expiresAt,
    durationDays: record.durationDays || 0,
    grantedBy: record.grantedBy || 0,
  };
}

async function getActivePremiumByTelegramId(telegramId) {
  const id = Number(telegramId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const record = await PremiumUser.findOne({ telegramId: id, isActive: true }).lean();
  if (!record) return null;

  if (!isPremiumRecordActive(record)) {
    await PremiumUser.updateOne({ _id: record._id }, { $set: { isActive: false, updatedAt: new Date() } }).catch(() => {});
    return null;
  }

  return record;
}

async function attachPremiumToUser(user) {
  if (!user) return user;

  const plain = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  const premium = await getActivePremiumByTelegramId(plain.telegramId);
  return {
    ...plain,
    premium: buildPremiumMeta(premium),
  };
}

async function attachPremiumToUsers(users = []) {
  return Promise.all((users || []).map((user) => attachPremiumToUser(user)));
}

async function resolvePremiumTarget(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const telegramId = Number(raw);
    const user = await User.findOne({ telegramId }).lean();
    return {
      telegramId,
      username: user?.username || '',
      profileId: user?.profileId || 0,
      user: user || null,
    };
  }

  const username = normalizeUsername(raw);
  if (!username) return null;

  const user = await User.findOne({ username: new RegExp(`^${escapeRegExp(username)}$`, 'i') }).lean();
  if (!user) return null;

  return {
    telegramId: Number(user.telegramId),
    username: user.username || username,
    profileId: user.profileId || 0,
    user,
  };
}

async function grantPremium(target, days, grantedBy) {
  if (!target?.telegramId) throw new Error('Invalid premium target');

  const now = new Date();
  const expiresAt = premiumExpiresAt(days, now);

  return PremiumUser.findOneAndUpdate(
    { telegramId: Number(target.telegramId) },
    {
      $set: {
        telegramId: Number(target.telegramId),
        username: target.username || '',
        profileId: Number(target.profileId || 0),
        grantedBy: Number(grantedBy),
        durationDays: Number(days),
        startsAt: now,
        expiresAt,
        isActive: true,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true, new: true }
  );
}

async function revokePremium(target, revokedBy) {
  if (!target?.telegramId) throw new Error('Invalid premium target');

  return PremiumUser.findOneAndUpdate(
    { telegramId: Number(target.telegramId), isActive: true },
    {
      $set: {
        isActive: false,
        revokedBy: Number(revokedBy || 0),
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
}

function formatPremiumUntil(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

module.exports = {
  OFFICIAL_BIKA_PREMIUM_OWNER_ID,
  isPremiumOwner,
  normalizeUsername,
  parsePremiumDuration,
  premiumExpiresAt,
  isPremiumRecordActive,
  buildPremiumMeta,
  getActivePremiumByTelegramId,
  attachPremiumToUser,
  attachPremiumToUsers,
  resolvePremiumTarget,
  grantPremium,
  revokePremium,
  formatPremiumUntil,
};
