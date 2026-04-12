const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type RiseMarket = {
  rise_market_address: string;
  mint_token: string;
  mint_main: string;
  token_name: string;
  token_symbol: string;
  token_image?: string;
  token_decimals: number;
  creator: string;
  price: string;
  starting_price?: string;
  mayflower_floor: string;
  mayflower_token_supply: string;
  mayflower_total_cash_liquidity: string;
  mayflower_total_debt: string;
  mayflower_total_collateral: string;
  volume_h24_usd: string;
  volume_all_time_usd: string;
  market_cap_usd: string;
  holders_count: number;
  creator_fee_percent: number;
  gov_buy_fee_micro_basis_points: number;
  gov_sell_fee_micro_basis_points: number;
  disableSell?: boolean;
  disable_sell?: boolean;
  twitter?: string;
  discord?: string;
  telegram?: string;
  created_at: string;
};

type MarketResponse = {
  ok: boolean;
  error?: string;
  market?: RiseMarket;
};

export class RiseApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RiseApiError";
  }
}

export class RiseApiClient {
  private readonly apiKeys: string[];
  private nextKeyIndex = 0;

  constructor(
    private readonly baseUrl: string,
    apiKeys: string | string[],
  ) {
    const normalizedKeys = (Array.isArray(apiKeys) ? apiKeys : [apiKeys])
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    if (normalizedKeys.length === 0) {
      throw new Error("At least one Rise API key is required");
    }

    this.apiKeys = normalizedKeys;
  }

  async getMarket(address: string): Promise<RiseMarket> {
    const response = await this.request<MarketResponse>(`/markets/${address}`);

    if (!response.ok || !response.market) {
      throw new RiseApiError(response.error ?? "Market not found");
    }

    return response.market;
  }

  getCollateralSymbol(mintMain: string): string {
    if (mintMain === SOL_MINT) {
      return "SOL";
    }

    if (mintMain === USDC_MINT) {
      return "USDC";
    }

    return "MAIN";
  }

  getCollateralDecimals(mintMain: string): number {
    if (mintMain === USDC_MINT) {
      return 6;
    }

    return 9;
  }

  private async request<T>(path: string): Promise<T> {
    let lastRateLimitError: RiseApiError | null = null;

    for (let attempt = 0; attempt < this.apiKeys.length; attempt += 1) {
      const apiKey = this.getNextApiKey();

      try {
        return await this.requestWithApiKey<T>(path, apiKey);
      } catch (error) {
        if (!(error instanceof RiseApiError)) {
          throw error;
        }

        if (error.status !== 429 || attempt === this.apiKeys.length - 1) {
          throw error;
        }

        lastRateLimitError = error;
      }
    }

    if (lastRateLimitError) {
      throw lastRateLimitError;
    }

    throw new RiseApiError("Rise API request failed unexpectedly");
  }

  private getNextApiKey(): string {
    const apiKey = this.apiKeys[this.nextKeyIndex];
    this.nextKeyIndex = (this.nextKeyIndex + 1) % this.apiKeys.length;
    return apiKey;
  }

  private async requestWithApiKey<T>(path: string, apiKey: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "x-api-key": apiKey,
      },
    });

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      throw new RiseApiError(
        `Rise API returned a non-JSON response for ${path}`,
        response.status,
      );
    }

    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `Rise API request failed with status ${response.status}`;

      throw new RiseApiError(message, response.status);
    }

    return payload as T;
  }
}
