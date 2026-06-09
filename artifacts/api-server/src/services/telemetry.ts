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
let tradeSimInterval: ReturnType<typeof setInterval> | null = null;
const tradeHistory: TradeEntry[] = [];
let lastTradeTime = 0;

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randomWallet(): string {
  const rand = (len: number) =>
    Array.from(
      { length: len },
      () => BASE58_CHARS[Math.floor(Math.random() * BASE58_CHARS.length)],
    ).join("");
  return `${rand(4)}…${rand(4)}`;
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function estimateHolders(usdMarketCap: number): number {
  const estimate = Math.round(Math.sqrt(usdMarketCap) * 2.2);
  return Math.max(50, estimate);
}

function simulateTrade(): TradeEntry {
  const mc = latestData.usdMarketCap ?? 100_000;
  const isBuy = Math.random() > 0.45;
  const scale = Math.max(0.005, Math.sqrt(mc / 1_000_000) * 0.4);
  const solAmount = parseFloat(
    (Math.random() * scale * 3 + 0.005).toFixed(4),
  );
  const price = latestData.price ?? 0.00001;
  const solPrice = 155;
  const tokenAmount = Math.round((solAmount * solPrice) / price);
  const now = Date.now();
  const date = new Date(now);
  return {
    id: randomId(),
    type: isBuy ? "buy" : "sell",
    solAmount,
    tokenAmount,
    wallet: randomWallet(),
    timestamp: now,
    timeStr: date.toLocaleTimeString("en-US", { hour12: false }),
  };
}

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
      partial.holders = estimateHolders(fdv);
      const GRAD_MC = 69_000;
      partial.bondingProgress = Math.min(
        100,
        Math.round((fdv / GRAD_MC) * 100),
      );
    }
    if (baseToken?.symbol) partial.symbol = String(baseToken.symbol);
  } catch (err) {
    logger.warn({ err }, "Dexscreener fetch failed — using cached data");
  }
  return partial;
}

function seedInitialTrades(): void {
  if (tradeHistory.length > 0) return;
  const mc = latestData.usdMarketCap;
  if (!mc) return;
  const now = Date.now();
  for (let i = 0; i < 25; i++) {
    const isBuy = Math.random() > 0.4;
    const scale = Math.max(0.005, Math.sqrt(mc / 1_000_000) * 0.4);
    const solAmount = parseFloat(
      (Math.random() * scale * 3 + 0.005).toFixed(4),
    );
    const price = latestData.price ?? 0.00001;
    const solPrice = 155;
    const tokenAmount = Math.round((solAmount * solPrice) / price);
    const ts = now - i * 14000 - Math.floor(Math.random() * 10000);
    const date = new Date(ts);
    tradeHistory.push({
      id: randomId(),
      type: isBuy ? "buy" : "sell",
      solAmount,
      tokenAmount,
      wallet: randomWallet(),
      timestamp: ts,
      timeStr: date.toLocaleTimeString("en-US", { hour12: false }),
    });
  }
  tradeHistory.sort((a, b) => b.timestamp - a.timestamp);
}

function startTradeSimulation(): void {
  if (tradeSimInterval) clearInterval(tradeSimInterval);
  tradeSimInterval = setInterval(
    () => {
      if (!latestData.usdMarketCap || clients.size === 0) return;
      const now = Date.now();
      if (now - lastTradeTime < 700) return;
      lastTradeTime = now;

      const trade = simulateTrade();
      tradeHistory.unshift(trade);
      if (tradeHistory.length > 100) tradeHistory.splice(80);

      latestData = {
        ...latestData,
        trades: [...tradeHistory],
        lastUpdated: Date.now(),
      };
      broadcast({ type: "update", data: latestData });
    },
    1000 + Math.random() * 1000,
  );
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

    seedInitialTrades();

    if (dexData.holders != null || dexData.usdMarketCap != null) {
      broadcast({ type: "update", data: latestData });
    } else {
      broadcast({
        type: "update",
        data: { ...latestData, lastUpdated: Date.now() },
      });
    }
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
  startTradeSimulation();
  logger.info({ mint: currentConfig.mintAddress }, "Polling started via Dexscreener");
}
