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

export type RiseTransaction = {
  transaction_type: string;
  wallet_address: string;
  price: string;
  floor_price: string;
  amount_put: string;
  amount_received: string;
  token_supply: string;
  transaction_signature: string;
  slot: number;
  created_at: string;
  volume_usd?: string;
};

type MarketResponse = {
  ok: boolean;
  error?: string;
  market?: RiseMarket;
};

type TransactionsResponse = {
  ok: boolean;
  error?: string;
  transactions?: RiseTransaction[];
};

export class RiseApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RiseApiError";
  }
}

export class RiseApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async getMarket(address: string): Promise<RiseMarket> {
    const response = await this.request<MarketResponse>(`/markets/${address}`);

    if (!response.ok || !response.market) {
      throw new RiseApiError(response.error ?? "Market not found");
    }

    return response.market;
  }

  async getTransactions(address: string, limit = 5): Promise<RiseTransaction[]> {
    const response = await this.request<TransactionsResponse>(
      `/markets/${address}/transactions?page=1&limit=${limit}`,
    );

    if (!response.ok) {
      throw new RiseApiError(response.error ?? "Unable to load transactions");
    }

    return response.transactions ?? [];
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
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "x-api-key": this.apiKey,
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
