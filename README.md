# Rise Telegram Bot

Telegram bot that accepts a Rise token mint or Rise market address and returns a formatted token card with image, market stats, recent activity, and quick links.

## What it shows

- token name, symbol, and image
- current price and floor price
- market cap, 24h volume, liquidity, holders, and age
- quick links to Rise and Solscan
- admin usage stats via `/stats`

## Requirements

- Node.js 20+
- Telegram bot token from BotFather
- Rise API key for `https://public.rise.rich`

## Setup

1. Copy `.env.example` to `.env`
2. Fill in:

```env
TELEGRAM_BOT_TOKEN=...
RISE_API_KEY=...
RISE_API_KEYS=key_1,key_2,key_3,key_4,key_5
RISE_BASE_URL=https://public.rise.rich
ADMIN_TELEGRAM_USER_ID=...
```

`RISE_API_KEYS` is optional but recommended when you have multiple keys. The bot rotates keys in round-robin order and automatically retries with the next key when a request is rate-limited (`429`).

3. Install dependencies:

```bash
npm install
```

4. Start the bot:

```bash
npm run start
```

## Usage

- `/start`
- `/help`
- `/token <mint-or-market-address>`
- or paste a Rise address directly into chat
- `/stats` for the admin user configured in `ADMIN_TELEGRAM_USER_ID`

## Notes

- The Rise REST API accepts either the token mint or the Rise market address for market lookups, quotes, and transactions.
- This bot uses the documented Rise REST endpoints and includes the required `x-api-key` header.
- If Telegram cannot send the token image, the bot falls back to a text-only message automatically.
- Usage stats are stored in `data/usage-stats.json`. On Render, local files are not durable across full rebuilds/redeploys unless you attach persistent storage or move this to a database.

## Relevant docs

- [Rise integration docs](https://github.com/riserich/rise-docs)
- [Rise REST API guide](https://raw.githubusercontent.com/riserich/rise-docs/main/docs/API.md)
