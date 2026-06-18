# BikaRs / Cupid Bot

Telegram Cupid profile bot built with Node.js, Telegraf, Express, and MongoDB.

## Features

- Profile create/edit flow
- Profile photo/video media support, 1 to 3 items per user
- MongoDB stores media metadata only: `fileId`, `fileUniqueId`, backup channel id, and backup message id
- Cupid Database channel backup support
- Backup channel post caption includes clickable user mention
- Add new media without deleting old media
- Replace old media with new media and create new backup posts marked as `Cupid Media Post Update`
- Girls list / Boys list / Random profile
- Like, love, laugh reactions
- Reaction notification
- Report profile
- Admin panel
- Ban / unban / delete profile
- Broadcast
- Hide/show own profile
- Delete own profile
- Render webhook deployment support

## Project Structure

```txt
BikaRs/
├── index.js
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── config/
│   └── env.js
├── models/
│   ├── User.js
│   ├── Reaction.js
│   └── Report.js
├── middlewares/
│   ├── auth.js
│   └── privateOnly.js
├── commands/
│   ├── start.js
│   ├── profile.js
│   ├── match.js
│   ├── privacy.js
│   └── admin.js
└── utils/
    ├── escapeHtml.js
    ├── keyboards.js
    └── media.js
```

## ENV Setup

Copy `.env.example` to `.env` and fill your real values.

```env
BOT_TOKEN=your_bot_token
MONGODB_URI=your_mongodb_uri
WEBHOOK_URL=https://your-app-name.onrender.com
PORT=10000
ADMIN_IDS=123456789,987654321
CUPID_DATABASE_CHANNEL_ID=-1004378314304
MAX_PROFILE_MEDIA=3
```

`WEBHOOK_URL` must be the base HTTPS URL only. Do not add `/webhook` manually.

## Cupid Database Channel Setup

1. Open Telegram channel `-1004378314304` or your own backup channel.
2. Add the bot as channel admin.
3. Give the bot permission to post messages.
4. Put the channel id in `CUPID_DATABASE_CHANNEL_ID`.

When a user uploads photo/video media, the bot posts a backup copy to this channel. MongoDB only stores metadata, not real media files.

## Media Flow

Profile creation:

```txt
User fills profile info
User sends photo/video 1-3 items
Bot posts each media to Cupid Database channel
Bot stores fileId + backup message id in MongoDB
User presses Done
Profile is saved
```

Media edit menu:

```txt
🖼 ပုံထည့်/ပြင်မယ်
├── ➕ ပုံအသစ်ထပ်ထည့်မယ်
└── ♻️ ပုံအစားထိုးမယ်
```

Replace mode posts new backup messages with the caption title `Cupid Media Post Update`, then MongoDB is updated with the new `fileId` and `backupMessageId` values.

## Local Run

```bash
npm install
npm start
```

## Render Deploy

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

Health check URL:

```txt
/
```

Webhook path is automatically set to:

```txt
/webhook
```

## Commands

User commands:

```txt
/start
/help
/privacy
/delete_my_profile
/hide
/show
```

Admin commands:

```txt
/admin
/ban <telegramId>
/unban <telegramId>
/deleteprofile <telegramId>
/broadcast <message>
```

## Button Styles

The project uses helper functions in `utils/keyboards.js` for Telegram button styles:

```js
callbackButton('Text', 'callback:data', BUTTON_STYLE.PRIMARY)
callbackButton('Text', 'callback:data', BUTTON_STYLE.SUCCESS)
callbackButton('Text', 'callback:data', BUTTON_STYLE.DANGER)
urlButton('Open', 'https://t.me/username', BUTTON_STYLE.PRIMARY)
replyButton('Menu Text', BUTTON_STYLE.SUCCESS)
```

Style mapping:

```txt
primary = blue
success = green
danger  = red
```

Most button text also keeps emoji labels, so older Telegram clients still show clear actions even if style rendering is unavailable.
