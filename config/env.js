require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const WEBHOOK_URL = String(process.env.WEBHOOK_URL || '').trim();
const PORT = parseInt(process.env.PORT || '10000', 10);
const ADMIN_IDS = String(process.env.ADMIN_ID || process.env.ADMIN_IDS || '')
  .split(',')
  .map((value) => Number(String(value).trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

const ALLOWED_STATUSES = [
  'in relationship',
  'single',
  'ကြေကွဲလူငယ်',
  'စော်မရှိ',
  'ဘဲမရှိ',
  'လင်ရှိတယ်',
  'မယားရှိတယ်',
];

function validateEnv() {
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN in .env');
  if (!MONGODB_URI) throw new Error('Missing MONGODB_URI in .env');
  if (!WEBHOOK_URL) throw new Error('Missing WEBHOOK_URL in .env');
  if (!/^https:\/\//i.test(WEBHOOK_URL) || WEBHOOK_URL.includes('/webhook')) {
    throw new Error('WEBHOOK_URL must be base https URL only, example: https://your-app.onrender.com');
  }
}

module.exports = {
  BOT_TOKEN,
  MONGODB_URI,
  WEBHOOK_URL,
  PORT,
  ADMIN_IDS,
  ALLOWED_STATUSES,
  validateEnv,
};
