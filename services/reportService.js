const Report = require('../models/Report');

async function createReport({ reporterId, targetUserId }) {
  return Report.findOneAndUpdate(
    { reporterId, targetUserId },
    {
      $set: {
        reason: 'အတုအယောင် profile',
        status: 'pending',
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true }
  );
}

module.exports = { createReport };
