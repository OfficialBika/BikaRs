const User = require('../models/User');
const Counter = require('../models/Counter');

const PROFILE_COUNTER_KEY = 'profileId';

function isValidProfileId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0;
}

function profileIdMissingQuery() {
  return {
    $or: [
      { profileId: { $exists: false } },
      { profileId: null },
      { profileId: 0 },
    ],
  };
}

async function setCounter(seq) {
  await Counter.findOneAndUpdate(
    { _id: PROFILE_COUNTER_KEY },
    { $set: { seq: Number(seq) || 0, updatedAt: new Date() } },
    { upsert: true, new: true }
  );
}

async function reserveNextProfileId() {
  const counter = await Counter.findOneAndUpdate(
    { _id: PROFILE_COUNTER_KEY },
    { $inc: { seq: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  return Number(counter.seq);
}

async function getMaxProfileId() {
  const maxUser = await User.findOne({ profileId: { $type: 'number' } })
    .sort({ profileId: -1 })
    .select('profileId')
    .lean();

  return isValidProfileId(maxUser?.profileId) ? Number(maxUser.profileId) : 0;
}

async function backfillProfileIds() {
  const existingWithIdCount = await User.countDocuments({
    isProfileComplete: true,
    profileId: { $type: 'number' },
  });

  let seq = existingWithIdCount > 0 ? await getMaxProfileId() : 0;

  const users = await User.find({
    isProfileComplete: true,
    ...profileIdMissingQuery(),
  })
    .sort({ createdAt: 1, telegramId: 1 })
    .select('_id telegramId createdAt profileId')
    .lean();

  for (const user of users) {
    seq += 1;
    await User.updateOne(
      { _id: user._id, ...profileIdMissingQuery() },
      { $set: { profileId: seq, updatedAt: new Date() } }
    );
  }

  await setCounter(Math.max(seq, await getMaxProfileId()));
  console.log(`Profile ID backfill completed. Updated: ${users.length}, current seq: ${Math.max(seq, await getMaxProfileId())}`);
}

async function ensureProfileId(user) {
  if (!user?._id) return user;
  if (isValidProfileId(user.profileId)) return user;

  const profileId = await reserveNextProfileId();

  const result = await User.findOneAndUpdate(
    {
      _id: user._id,
      isProfileComplete: true,
      ...profileIdMissingQuery(),
    },
    { $set: { profileId, updatedAt: new Date() } },
    { new: true }
  );

  if (result) return result;

  return User.findById(user._id);
}

module.exports = {
  backfillProfileIds,
  ensureProfileId,
  reserveNextProfileId,
  isValidProfileId,
};
