const mongoose = require('mongoose');
const User = require('../models/User');
const Reaction = require('../models/Reaction');
const Report = require('../models/Report');
const PremiumUser = require('../models/PremiumUser');

async function migrateIndexes() {
  await Promise.all([
    User.syncIndexes(),
    Reaction.syncIndexes(),
    Report.syncIndexes(),
    PremiumUser.syncIndexes(),
  ]);
}

module.exports = { migrateIndexes };
