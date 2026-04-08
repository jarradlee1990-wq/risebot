# Rise Telegram Bot

Telegram bot that accepts a Rise token mint or Rise market address and returns a formatted token card with image, market stats, recent activity, and quick links.

## What it shows

- token name, symbol, and image
- current price and floor price
- market cap, 24h volume, and all-time volume
- liquidity, debt, collateral, supply, holders, and age
- buy/sell fees and creator fee
- recent transactions
- quick links to DexScreener, Solscan, and project socials

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
RISE_BASE_URL=https://public.rise.rich
```

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

## Notes

- The Rise REST API accepts either the token mint or the Rise market address for market lookups, quotes, and transactions.
- This bot uses the documented Rise REST endpoints and includes the required `x-api-key` header.
- If Telegram cannot send the token image, the bot falls back to a text-only message automatically.

## Relevant docs

- [Rise integration docs](https://github.com/riserich/rise-docs)
- [Rise REST API guide](https://raw.githubusercontent.com/riserich/rise-docs/main/docs/API.md)
