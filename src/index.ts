import "dotenv/config";

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";
import { Markup, Telegraf } from "telegraf";

import { buildMarketCaption } from "./format.js";
import { RiseApiClient, RiseApiError } from "./rise-api.js";
import { UsageStore, type UsageEvent } from "./usage-store.js";

const configSchema = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
    RISE_API_KEY: z.string().optional(),
    RISE_API_KEYS: z.string().optional(),
    RISE_BASE_URL: z.string().url().default("https://public.rise.rich"),
    ADMIN_TELEGRAM_USER_ID: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const hasSingleKey = Boolean(value.RISE_API_KEY?.trim());
    const hasMultipleKeys = Boolean(value.RISE_API_KEYS?.trim());

    if (!hasSingleKey && !hasMultipleKeys) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RISE_API_KEYS"],
        message: "Set RISE_API_KEYS or RISE_API_KEY",
      });
    }
  });

const config = configSchema.parse({
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  RISE_API_KEY: process.env.RISE_API_KEY,
  RISE_API_KEYS: process.env.RISE_API_KEYS,
  RISE_BASE_URL: process.env.RISE_BASE_URL ?? "https://public.rise.rich",
  ADMIN_TELEGRAM_USER_ID: process.env.ADMIN_TELEGRAM_USER_ID,
});

function getRiseApiKeys(): string[] {
  const csvKeys =
    config.RISE_API_KEYS?.split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0) ?? [];

  if (csvKeys.length > 0) {
    return csvKeys;
  }

  if (config.RISE_API_KEY?.trim()) {
    return [config.RISE_API_KEY.trim()];
  }

  throw new Error("No Rise API keys configured");
}

const riseApi = new RiseApiClient(config.RISE_BASE_URL, getRiseApiKeys());
const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
const usageStore = new UsageStore(join(process.cwd(), "data", "usage-stats.json"));

const ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ADDRESS_GLOBAL_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const RISE_MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{28,40}rise$/i;

function getUsageEvent(ctx: {
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    username?: string;
  };
  from?: {
    id: number;
    username?: string;
    first_name?: string;
  };
}): UsageEvent {
  return {
    chatId: ctx.chat.id,
    chatType: ctx.chat.type,
    chatTitle: "title" in ctx.chat ? ctx.chat.title : undefined,
    chatUsername: "username" in ctx.chat ? ctx.chat.username : undefined,
    userId: ctx.from?.id,
    username: ctx.from?.username,
    firstName: ctx.from?.first_name,
  };
}

function isAdminUser(userId: number | undefined): boolean {
  return Boolean(
    userId !== undefined &&
      config.ADMIN_TELEGRAM_USER_ID &&
      String(userId) === config.ADMIN_TELEGRAM_USER_ID,
  );
}

function formatChatLabel(chat: {
  title?: string;
  username?: string;
  firstName?: string;
  id: string;
}): string {
  return chat.title ?? chat.username ?? chat.firstName ?? chat.id;
}

async function sendStatsMessage(chatId: number, threadId?: number): Promise<void> {
  const summary = usageStore.getSummary();
  const lines = [
    "Bot usage stats",
    "",
    `Rise API requests (1h): ${summary.requestsLastHour}`,
    `Rise API requests (24h): ${summary.requestsLast24h}`,
    `Requests failed (1h): ${summary.failedRequestsLastHour}`,
    `Requests ok (1h): ${summary.successfulRequestsLastHour}`,
    "",
    `Unique chats: ${summary.uniqueChats}`,
    `Private chats: ${summary.privateChats}`,
    `Group chats: ${summary.groupChats}`,
    `Unique users: ${summary.uniqueUsers}`,
    `Active chats (24h): ${summary.activeChats24h}`,
    `Active groups (24h): ${summary.activeGroups24h}`,
    `Total messages: ${summary.totalMessages}`,
    `Total lookups: ${summary.totalLookups}`,
    `Successful lookups: ${summary.successfulLookups}`,
    `Failed lookups: ${summary.failedLookups}`,
    "",
    "Top groups by lookups:",
    ...(
      summary.topGroups.length > 0
        ? summary.topGroups.map(
            (group, index) =>
              `${index + 1}. ${formatChatLabel(group)} - ${group.lookupCount} lookups / ${group.messageCount} msgs`,
          )
        : ["No groups tracked yet."]
    ),
    "",
    `Updated: ${summary.updatedAt}`,
  ];

  await bot.telegram.sendMessage(chatId, lines.join("\n"), {
    ...(threadId ? { message_thread_id: threadId } : {}),
  });
}

function extractAddress(
  input: string,
  options: { riseOnly?: boolean } = {},
): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const matches = trimmed.match(ADDRESS_GLOBAL_REGEX) ?? [];

  const riseMint = matches.find((candidate) => RISE_MINT_REGEX.test(candidate));
  if (riseMint) {
    return riseMint;
  }

  if (options.riseOnly) {
    return null;
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

async function sendMarketCard(
  chatId: number,
  address: string,
  threadId?: number,
) {
  const market = await riseApi.getMarket(address);

  const collateralSymbol = riseApi.getCollateralSymbol(market.mint_main);
  const collateralDecimals = riseApi.getCollateralDecimals(market.mint_main);
  const card = buildMarketCaption(
    market,
    collateralSymbol,
    collateralDecimals,
  );
  const keyboard = buildKeyboard(card);

  const threadOpts = threadId ? { message_thread_id: threadId } : {};

  if (market.token_image) {
    try {
      await bot.telegram.sendPhoto(chatId, market.token_image, {
        caption: card.caption,
        parse_mode: "HTML",
        ...threadOpts,
        ...keyboard,
      });
      return;
    } catch (error) {
      console.warn("Unable to send token image, falling back to text:", error);
    }
  }

  await bot.telegram.sendMessage(chatId, card.caption, {
    parse_mode: "HTML",
    ...threadOpts,
    ...keyboard,
  });
}

async function handleLookup(
  chatId: number,
  rawInput: string,
  usageEvent?: UsageEvent,
  options: { riseOnly?: boolean; threadId?: number } = {},
) {
  const address = extractAddress(rawInput, { riseOnly: options.riseOnly });
  return handleResolvedLookup(chatId, address, usageEvent, options.threadId);
}

async function handleResolvedLookup(
  chatId: number,
  address: string | null,
  usageEvent?: UsageEvent,
  threadId?: number,
) {
  if (!address) {
    return false;
  }

  const threadOpts = threadId ? { message_thread_id: threadId } : {};

  await bot.telegram.sendChatAction(chatId, "upload_photo", threadOpts);

  try {
    await sendMarketCard(chatId, address, threadId);
    if (usageEvent) {
      await usageStore.recordLookup(usageEvent, "success");
    }
    return true;
  } catch (error) {
    if (error instanceof RiseApiError) {
      if (usageEvent) {
        await usageStore.recordLookup(usageEvent, "failure");
      }
      await bot.telegram.sendMessage(
        chatId,
        `I couldn't load that Rise token.\n\n${error.message}`,
        threadOpts,
      );
      return true;
    }

    console.error("Unexpected lookup failure:", error);
    if (usageEvent) {
      await usageStore.recordLookup(usageEvent, "failure");
    }
    await bot.telegram.sendMessage(
      chatId,
      "Something went wrong while loading that token. Check your API key and try again.",
      threadOpts,
    );
    return true;
  }
}

async function sendUsageMessage(chatId: number, threadId?: number) {
  const threadOpts = threadId ? { message_thread_id: threadId } : {};
  await bot.telegram.sendMessage(
    chatId,
    "Send a Rise token mint or Rise market address.\n\nExamples:\n`/token 7r8Z8FMKnbfALBL8A86cnYCgboBYyoHw4bZ4Kz34rise`\n`7r8Z8FMKnbfALBL8A86cnYCgboBYyoHw4bZ4Kz34rise`",
    { parse_mode: "Markdown", ...threadOpts },
  );
}

async function handleTokenCommand(
  chatId: number,
  rawInput: string,
  usageEvent?: UsageEvent,
  threadId?: number,
) {
  const handled = await handleLookup(chatId, rawInput, usageEvent, { threadId });
  if (!handled) {
    await sendUsageMessage(chatId, threadId);
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

bot.command("stats", async (ctx) => {
  if (!isAdminUser(ctx.from?.id)) {
    return;
  }

  await sendStatsMessage(ctx.chat.id, ctx.message.message_thread_id);
});

bot.command("token", async (ctx) => {
  const usageEvent = getUsageEvent(ctx);
  await usageStore.recordMessage(usageEvent);
  const text = ctx.message.text.replace(/^\/token(@\w+)?/i, "").trim();
  await handleTokenCommand(
    ctx.chat.id,
    text,
    usageEvent,
    ctx.message.message_thread_id,
  );
});

bot.on("text", async (ctx) => {
  const usageEvent = getUsageEvent(ctx);
  await usageStore.recordMessage(usageEvent);

  if (/^\/\w+/.test(ctx.message.text)) {
    return;
  }

  await handleLookup(ctx.chat.id, ctx.message.text, usageEvent, {
    riseOnly: true,
    threadId: ctx.message.message_thread_id,
  });
});

bot.catch((error) => {
  console.error("Telegram bot error:", error);
});

await mkdir(join(process.cwd(), "data"), { recursive: true });
await usageStore.load();

bot.launch().then(() => {
  console.log("Rise Telegram bot is running.");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
