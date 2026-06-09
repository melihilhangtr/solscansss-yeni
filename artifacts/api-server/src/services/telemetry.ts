import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import { logger } from "../lib/logger.js";

const CONFIG_PATH = path.join(process.cwd(), "config.json");

export interface Config {
  mintAddress: string;
  tokenName: string;
  tokenImageUrl: string;
  backgroundImageUrl: string;
  siteDesign: "cyberpunk" | "clean-tech" | "gold";
}

export interface TradeEntry {
  id: string;
  type: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  wallet: string;
  timestamp: number;
  timeStr: string;
}

export interface TelemetryData {
  holders: number | null;
  usdMarketCap: number | null;
  price: number | null;
  bondingProgress: number | null;
  symbol: string | null;
  trades: TradeEntry[];
  lastUpdated: number;
}

const DEFAULT_CONFIG: Config = {
  mintAddress: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
  tokenName: "Fartcoin",
  tokenImageUrl: "",
  backgroundImageUrl: "",
  siteDesign: "cyberpunk",
};

let currentConfig: Config = { ...DEFAULT_CONFIG };
let latestData: TelemetryData = {
  holders: null,
  usdMarketCap: null,
  price: null,
  bondingProgress: null,
  symbol: null,
  trades: [],
  lastUpdated: Date.now(),
};

const clients = new Set<Response>();
let pollingInterval: ReturnType<typeof setInterval> | null = null;
const tradeHistory: TradeEntry[] = [];

export function addClient(res: Response): void {
  clients.add(res);
}

export function removeClient(res: Response): void {
  clients.delete(res);
}

function broadcast(event: unknown): void {
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(msg);
    } catch {
      clients.delete(res);
    }
  }
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    currentConfig = JSON.parse(raw) as Config;
    return currentConfig;
  } catch {
    currentConfig = { ...DEFAULT_CONFIG };
    await fs.writeFile(
      CONFIG_PATH,
      JSON.stringify(DEFAULT_CONFIG, null, 2),
      "utf-8",
    );
    return currentConfig;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const mintChanged = config.mintAddress !== currentConfig.mintAddress;
  currentConfig = config;
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  broadcast({ type: "config", data: config });
  if (mintChanged) {
    tradeHistory.length = 0;
    latestData = {
      holders: null,
      usdMarketCap: null,
      price: null,
      bondingProgress: null,
      symbol: null,
      trades: [],
      lastUpdated: Date.now(),
    };
    startPolling();
  }
}

export function getConfig(): Config {
  return currentConfig;
}

export function getLatestData(): TelemetryData {
  return latestData;
}

async function fetchDexscreener(
  mintAddress: string,
): Promise<Partial<TelemetryData>> {
  const partial: Partial<TelemetryData> = {};
  try {
    const resp = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
      { timeout: 8000 },
    );
    const pairs = resp.data?.pairs as Array<Record<string, unknown>>;
    if (!Array.isArray(pairs) || pairs.length === 0) {
      logger.warn({ mintAddress }, "Dexscreener returned no pairs");
      return partial;
    }

    const pair = pairs.reduce(
      (best: Record<string, unknown>, p: Record<string, unknown>) => {
        const bLiq =
          ((best.liquidity as Record<string, unknown>)?.usd as number) || 0;
        const pLiq =
          ((p.liquidity as Record<string, unknown>)?.usd as number) || 0;
        return pLiq > bLiq ? p : best;
      },
      pairs[0],
    );

    const priceUsd = parseFloat(String(pair.priceUsd ?? "0"));
    const fdv =
      (pair.fdv as number) || (pair.marketCap as number) || null;
    const baseToken = pair.baseToken as Record<string, unknown> | undefined;

    if (priceUsd > 0) partial.price = priceUsd;
    if (fdv) {
      partial.usdMarketCap = fdv;
      const GRAD_MC = 24_000;
      partial.bondingProgress = Math.min(
        100,
        Math.round((fdv / GRAD_MC) * 100),
      );
    }
    if (baseToken?.symbol) partial.symbol = String(baseToken.symbol);
    if (pair.txns) {
      const txns = pair.txns as Record<string, unknown>;
      const h24 = txns.h24 as Record<string, unknown> | undefined;
      if (h24?.buys && h24?.sells) {
        const buys = h24.buys as number;
        const sells = h24.sells as number;
        partial.holders = buys + sells;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Dexscreener fetch failed — using cached data");
  }
  return partial;
}


async function poll(): Promise<void> {
  const mint = currentConfig.mintAddress;
  if (!mint) return;

  try {
    const dexData = await fetchDexscreener(mint);

    latestData = {
      ...latestData,
      ...dexData,
      trades: latestData.trades,
      lastUpdated: Date.now(),
    };

    broadcast({ type: "update", data: latestData });
  } catch (err) {
    logger.warn({ err }, "Poll failed — broadcasting last known data");
    broadcast({
      type: "update",
      data: { ...latestData, lastUpdated: Date.now() },
    });
  }
}

export function startPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  poll().catch(() => {});
  pollingInterval = setInterval(() => {
    poll().catch(() => {});
  }, 6000);
  logger.info({ mint: currentConfig.mintAddress }, "Polling started via Dexscreener");
}
