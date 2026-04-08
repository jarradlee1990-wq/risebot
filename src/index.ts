import "dotenv/config";

import { z } from "zod";
import { Markup, Telegraf } from "telegraf";

import { buildMarketCaption } from "./format.js";
import { RiseApiClient, RiseApiError } from "./rise-api.js";

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  RISE_API_KEY: z.string().min(1, "RISE_API_KEY is required"),
  RISE_BASE_URL: z.string().url().default("https://public.rise.rich"),
});

const config = configSchema.parse({
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  RISE_API_KEY: process.env.RISE_API_KEY,
  RISE_BASE_URL: process.env.RISE_BASE_URL ?? "https://public.rise.rich",
});

const riseApi = new RiseApiClient(config.RISE_BASE_URL, config.RISE_API_KEY);
const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

const ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ADDRESS_GLOBAL_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const RISE_MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{28,40}rise$/i;

function extractAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const matches = trimmed.match(ADDRESS_GLOBAL_REGEX) ?? [];

  const riseMint = matches.find((candidate) => RISE_MINT_REGEX.test(candidate));
  if (riseMint) {
    return riseMint;
  }

  const genericAddress = matches.find((candidate) => ADDRESS_REGEX.test(candidate));
  return genericAddress ?? null;
}

function buildKeyboard(links: {
  chartUrl: string;
  explorerUrl: string;
  twitterUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
}) {
  const rows = [
    [
      Markup.button.url("RISE", links.chartUrl),
      Markup.button.url("Solscan", links.explorerUrl),
    ],
  ];

  const socials = [
    links.twitterUrl ? Markup.button.url("Twitter", links.twitterUrl) : null,
    links.telegramUrl ? Markup.button.url("Telegram", links.telegramUrl) : null,
    links.discordUrl ? Markup.button.url("Discord", links.discordUrl) : null,
  ].filter((button): button is NonNullable<typeof button> => button !== null);

  if (socials.length > 0) {
    rows.push(socials);
  }

  return Markup.inlineKeyboard(rows);
}

async function sendMarketCard(chatId: number, address: string) {
  const [market, transactions] = await Promise.all([
    riseApi.getMarket(address),
    riseApi.getTransactions(address, 5),
  ]);

  const collateralSymbol = riseApi.getCollateralSymbol(market.mint_main);
  const collateralDecimals = riseApi.getCollateralDecimals(market.mint_main);
  const card = buildMarketCaption(
    market,
    transactions,
    collateralSymbol,
    collateralDecimals,
  );
  const keyboard = buildKeyboard(card);

  if (market.token_image) {
    try {
      await bot.telegram.sendPhoto(chatId, market.token_image, {
        caption: card.caption,
        parse_mode: "HTML",
        ...keyboard,
      });
      return;
    } catch (error) {
      console.warn("Unable to send token image, falling back to text:", error);
    }
  }

  await bot.telegram.sendMessage(chatId, card.caption, {
    parse_mode: "HTML",
    ...keyboard,
  });
}

async function handleLookup(chatId: number, rawInput: string) {
  const address = extractAddress(rawInput);

  if (!address) {
    await bot.telegram.sendMessage(
      chatId,
      "Send a Rise token mint or Rise market address.\n\nExamples:\n`/token 7r8Z8FMKnbfALBL8A86cnYCgboBYyoHw4bZ4Kz34rise`\n`7r8Z8FMKnbfALBL8A86cnYCgboBYyoHw4bZ4Kz34rise`",
      { parse_mode: "Markdown" },
    );
    return;
  }

  await bot.telegram.sendChatAction(chatId, "upload_photo");

  try {
    await sendMarketCard(chatId, address);
  } catch (error) {
    if (error instanceof RiseApiError) {
      await bot.telegram.sendMessage(
        chatId,
        `I couldn't load that Rise token.\n\n${error.message}`,
      );
      return;
    }

    console.error("Unexpected lookup failure:", error);
    await bot.telegram.sendMessage(
      chatId,
      "Something went wrong while loading that token. Check your API key and try again.",
    );
  }
}

bot.start(async (ctx) => {
  await ctx.reply(
    [
      "Send a Rise token mint or Rise market address and I will return a Telegram market card.",
      "",
      "Commands:",
      "/token <address> - fetch token info",
      "/help - show usage",
    ].join("\n"),
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    [
      "Usage:",
      "/token <Rise mint or Rise market address>",
      "",
      "You can also paste an address directly in chat.",
    ].join("\n"),
  );
});

bot.command("token", async (ctx) => {
  const text = ctx.message.text.replace(/^\/token(@\w+)?/i, "").trim();
  await handleLookup(ctx.chat.id, text);
});

bot.on("text", async (ctx) => {
  await handleLookup(ctx.chat.id, ctx.message.text);
});

bot.catch((error) => {
  console.error("Telegram bot error:", error);
});

bot.launch().then(() => {
  console.log("Rise Telegram bot is running.");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
