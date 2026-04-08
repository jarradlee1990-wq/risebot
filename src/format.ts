import type { RiseMarket, RiseTransaction } from "./rise-api.js";

type FormattedMarketCard = {
  caption: string;
  chartUrl: string;
  explorerUrl: string;
  twitterUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

function formatCompact(value: string | number | undefined, maximumFractionDigits = 1): string {
  if (value === undefined) {
    return "n/a";
  }

  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits,
  }).format(amount);
}

function formatScannerPrice(value: string | number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }

  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) {
    return "n/a";
  }

  if (amount === 0) {
    return "0";
  }

  if (Math.abs(amount) < 0.001) {
    const fixed = amount.toFixed(12);
    const [, decimalPartRaw = ""] = fixed.split(".");
    const decimalPart = decimalPartRaw.replace(/0+$/, "");

    let zeroCount = 0;
    while (zeroCount < decimalPart.length && decimalPart[zeroCount] === "0") {
      zeroCount += 1;
    }

    const significant = decimalPart.slice(zeroCount, zeroCount + 3) || "0";
    const subscriptDigits = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
    const zeroCountSubscript = String(zeroCount)
      .split("")
      .map((digit) => subscriptDigits[Number(digit)] ?? digit)
      .join("");

    return `0.0${zeroCountSubscript}${significant}`;
  }

  return formatNumber(amount, amount < 1 ? 6 : 4);
}

function formatTokenAmount(raw: string, decimals: number, maximumFractionDigits = 4): string {
  const numeric = Number(raw);

  if (!Number.isFinite(numeric)) {
    return "n/a";
  }

  return formatNumber(numeric / 10 ** decimals, maximumFractionDigits);
}

function formatDeltaPercent(current: string, starting?: string): string | null {
  const currentValue = Number(current);
  const startingValue = Number(starting);

  if (
    !Number.isFinite(currentValue) ||
    !Number.isFinite(startingValue) ||
    startingValue === 0
  ) {
    return null;
  }

  const percent = ((currentValue - startingValue) / startingValue) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${formatNumber(percent, 1)}%`;
}

function formatAge(createdAt: string): string {
  const created = new Date(createdAt);
  const diffMs = Date.now() - created.getTime();

  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return "n/a";
  }

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d`;
  }

  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function shortAddress(address: string, start = 6, end = 4): string {
  if (address.length <= start + end + 3) {
    return address;
  }

  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

function normalizeLink(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  if (url.startsWith("@")) {
    return `https://t.me/${url.slice(1)}`;
  }

  return `https://${url}`;
}

function toHandle(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(normalizeLink(url) ?? url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (!lastSegment) {
      return parsed.hostname.replace(/^www\./, "");
    }
    return `@${lastSegment}`;
  } catch {
    return url;
  }
}

export function buildMarketCaption(
  market: RiseMarket,
  _transactions: RiseTransaction[],
  collateralSymbol: string,
  collateralDecimals: number,
): FormattedMarketCard {
  const priceDelta = formatDeltaPercent(market.price, market.starting_price);
  const liquidityHuman = formatTokenAmount(
    market.mayflower_total_cash_liquidity,
    collateralDecimals,
  );
  const topLine = [
    `🟡 ${escapeHtml(market.token_name)} <code>$${escapeHtml(market.token_symbol)}</code>`,
    `[${formatCompact(market.market_cap_usd)}${priceDelta ? `/${priceDelta}` : ""}]`,
  ].join(" ");
  const socialLinks = {
    twitterUrl: normalizeLink(market.twitter),
    telegramUrl: normalizeLink(market.telegram),
    discordUrl: normalizeLink(market.discord),
  };
  const socialText = [
    toHandle(market.twitter),
    toHandle(market.telegram),
    toHandle(market.discord),
  ].filter((value): value is string => Boolean(value));

  const lines = [
    `<b>${topLine}</b>`,
    `<code>${escapeHtml(market.mint_token)}</code>`,
    "",
    "",
    `🛸 ${collateralSymbol} @ Rise`,
    `💰 Price: ${formatScannerPrice(market.price)} ${collateralSymbol} | Floor: ${formatScannerPrice(market.mayflower_floor)} ${collateralSymbol}`,
    `💎 FDV: ${formatCompact(market.market_cap_usd)} | Age: ${formatAge(market.created_at)}`,
    `📉 Liq: ${liquidityHuman} ${collateralSymbol} | 👥 ${formatCompact(market.holders_count, 0)} holders`,
    `📊 Vol: ${formatCompact(market.volume_h24_usd)}`,
    "",
    `📋 Mint: <code>${escapeHtml(shortAddress(market.mint_token, 10, 8))}</code>`,
    "",
    "",
    `Market: <code>${escapeHtml(shortAddress(market.rise_market_address))}</code>`,
    `Creator: <code>${escapeHtml(shortAddress(market.creator))}</code>`,
  ];

  return {
    caption: lines.filter(Boolean).join("\n"),
    chartUrl: `https://rise.rich/trade/${market.mint_token}`,
    explorerUrl: `https://solscan.io/token/${market.mint_token}`,
    ...socialLinks,
  };
}
