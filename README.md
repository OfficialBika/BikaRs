# BikaRs / Cupid Bot

Telegram Cupid profile bot built with Node.js, Telegraf, Express, and MongoDB.

## Features

- Profile create/edit flow
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
    └── keyboards.js
```

## ENV Setup

Copy `.env.example` to `.env` and fill your real values.

```env
BOT_TOKEN=your_bot_token
MONGODB_URI=your_mongodb_uri
WEBHOOK_URL=https://your-app-name.onrender.com
PORT=10000
ADMIN_IDS=123456789,987654321
```

`WEBHOOK_URL` must be the base HTTPS URL only. Do not add `/webhook` manually.

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

## Notes

This zip keeps the original bot behavior but splits the single `index.js` into clean modules for future updates.

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
