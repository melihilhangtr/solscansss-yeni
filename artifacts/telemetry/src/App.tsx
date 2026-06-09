import { useEffect, useRef, useState, useCallback } from "react";
import "./index.css";

// ─── Types ────────────────────────────────────────────────────
interface Config {
  mintAddress: string;
  tokenName: string;
  tokenImageUrl: string;
  backgroundImageUrl: string;
  siteDesign: "cyberpunk" | "clean-tech" | "gold";
}

interface TradeEntry {
  id: string;
  type: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  wallet: string;
  timestamp: number;
  timeStr: string;
}

interface TelemetryData {
  holders: number | null;
  usdMarketCap: number | null;
  price: number | null;
  bondingProgress: number | null;
  symbol: string | null;
  trades: TradeEntry[];
  lastUpdated: number;
}

// ─── Format helpers ───────────────────────────────────────────
function fmtNum(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtUSD(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}
function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  if (n < 0.000001) return n.toExponential(3);
  if (n < 0.01) return "$" + n.toFixed(8);
  return "$" + n.toFixed(6);
}

// ─── Color Extraction ─────────────────────────────────────────
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function applyDynamicColor(h: number, s: number, l: number) {
  const root = document.documentElement;
  const sC = Math.max(60, Math.min(s, 100));
  const lP = Math.max(50, Math.min(65, l + 15));
  const lB = Math.max(35, Math.min(55, l));
  root.style.setProperty("--primary", `hsl(${h}, ${sC}%, ${lP}%)`);
  root.style.setProperty("--border", `hsla(${h}, ${sC}%, ${lB}%, 0.3)`);
  root.style.setProperty("--border-glow", `hsla(${h}, ${sC}%, ${lP}%, 0.6)`);
  root.style.setProperty("--glow", `0 0 8px hsl(${h}, ${sC}%, ${lP}%), 0 0 20px hsla(${h}, ${sC}%, ${lP}%, 0.25)`);
  root.style.setProperty("--shadow", `0 0 30px hsla(${h}, ${sC}%, ${lP}%, 0.15)`);
  root.style.setProperty("--scanner-color", `hsla(${h}, ${sC}%, ${lP}%, 0.04)`);
}

function resetDynamicColor() {
  const root = document.documentElement;
  ["--primary","--border","--border-glow","--glow","--shadow","--scanner-color"]
    .forEach(v => root.style.removeProperty(v));
}

function extractDominantColor(imageUrl: string) {
  if (!imageUrl) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      const size = 40;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let bestH = 180, bestS = 70, bestL = 55, maxSat = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        if (a < 128) continue;
        const [h, s, l] = rgbToHsl(r, g, b);
        if (s > maxSat && l > 15 && l < 85) {
          maxSat = s; bestH = h; bestS = s; bestL = l;
        }
      }
      if (maxSat > 20) applyDynamicColor(bestH, bestS, bestL);
    } catch (_) { /* CORS tainted — silently ignore */ }
  };
  img.src = imageUrl;
}

// ─── StatCard ─────────────────────────────────────────────────
function StatCard({ label, value, sub, children }: { label: string; value: string; sub: string; children?: React.ReactNode }) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value && value !== "—") {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(t);
    }
  }, [value]);
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${flash ? " updated" : ""}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
      {children}
    </div>
  );
}

// ─── TradeRow ─────────────────────────────────────────────────
function TradeRow({ trade }: { trade: TradeEntry }) {
  return (
    <div className={`trade-row is-${trade.type}`}>
      <span className={`trade-type ${trade.type}`}>{trade.type.toUpperCase()}</span>
      <span className="trade-wallet">{trade.wallet}</span>
      <span className={`trade-sol ${trade.type}`}>{trade.solAmount.toFixed(3)} SOL</span>
      <span className="trade-tokens">{fmtNum(trade.tokenAmount)} T</span>
      <span className="trade-time">{trade.timeStr}</span>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [data, setData] = useState<TelemetryData>({
    holders: null, usdMarketCap: null, price: null,
    bondingProgress: null, symbol: null, trades: [], lastUpdated: Date.now(),
  });
  const [connState, setConnState] = useState<"" | "connected" | "error">("");
  const [chartLoaded, setChartLoaded] = useState(false);
  const [chartMint, setChartMint] = useState("");
  const seenIds = useRef(new Set<string>());
  const allTrades = useRef<TradeEntry[]>([]);

  // Apply config side-effects
  const applyConfig = useCallback((cfg: Config) => {
    setConfig(cfg);
    document.title = (cfg.tokenName || "Token") + " · Telemetry";
    const body = document.body;
    body.className = "";
    if (cfg.siteDesign === "clean-tech") body.classList.add("theme-clean-tech");
    else if (cfg.siteDesign === "gold") body.classList.add("theme-gold");

    const bgEl = document.getElementById("bg-layer");
    if (bgEl) {
      if (cfg.backgroundImageUrl) {
        bgEl.style.backgroundImage = `url("${cfg.backgroundImageUrl}")`;
        bgEl.style.opacity = "0.12";
        extractDominantColor(cfg.backgroundImageUrl);
      } else {
        bgEl.style.backgroundImage = "none";
        bgEl.style.opacity = "0";
        resetDynamicColor();
      }
    }
  }, []);

  // Handle telemetry update — merge new trades
  const applyUpdate = useCallback((update: TelemetryData) => {
    if (update.trades && update.trades.length > 0) {
      const newTrades = update.trades.filter(t => !seenIds.current.has(t.id));
      newTrades.forEach(t => seenIds.current.add(t.id));
      if (newTrades.length > 0) {
        allTrades.current = [...newTrades, ...allTrades.current].slice(0, 80);
      }
    }
    setData(prev => ({
      ...update,
      trades: allTrades.current,
      holders: update.holders ?? prev.holders,
      usdMarketCap: update.usdMarketCap ?? prev.usdMarketCap,
      price: update.price ?? prev.price,
      bondingProgress: update.bondingProgress ?? prev.bondingProgress,
      symbol: update.symbol ?? prev.symbol,
    }));
  }, []);

  // SSE connection
  useEffect(() => {
    let es: EventSource;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource("/api/stream");
      es.onopen = () => setConnState("connected");
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "config") applyConfig(msg.data as Config);
          if (msg.type === "update") applyUpdate(msg.data as TelemetryData);
        } catch (_) {}
      };
      es.onerror = () => {
        setConnState("error");
        es.close();
        retryTimer = setTimeout(connect, 3000);
      };
    }

    // Load config first, then connect SSE
    fetch("/api/config")
      .then(r => r.json())
      .then((cfg: Config) => applyConfig(cfg))
      .catch(() => {})
      .finally(() => connect());

    return () => {
      es?.close();
      clearTimeout(retryTimer);
    };
  }, [applyConfig, applyUpdate]);

  // Update chart when mint changes
  useEffect(() => {
    const mint = config?.mintAddress;
    if (mint && mint !== chartMint) {
      setChartMint(mint);
      setChartLoaded(false);
    }
  }, [config?.mintAddress, chartMint]);

  // Volume stats from trades
  const trades = data.trades;
  let buyVol = 0, sellVol = 0, buyCount = 0, sellCount = 0;
  trades.forEach(t => {
    if (t.type === "buy") { buyVol += t.solAmount; buyCount++; }
    else { sellVol += t.solAmount; sellCount++; }
  });
  const total = buyCount + sellCount;
  const buyPct = total > 0 ? Math.round((buyCount / total) * 100) : 50;
  const net = buyVol - sellVol;

  const mintDisplay = config?.mintAddress
    ? config.mintAddress.slice(0, 8) + "…" + config.mintAddress.slice(-8)
    : "—";

  const lastUpdateTime = data.lastUpdated
    ? new Date(data.lastUpdated).toLocaleTimeString("en-US", { hour12: false })
    : "—";

  const dexUrl = chartMint
    ? `https://dexscreener.com/solana/${chartMint}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=0&chartType=usd&interval=15`
    : "";

  const connLabel = { connected: "CONNECTED", error: "RECONNECTING", "": "CONNECTING" }[connState];

  return (
    <>
      <div id="bg-layer" className="bg-layer" />
      <div className="grid-layer" />

      <div id="app">
        {/* Header */}
        <header>
          <div className="header-left">
            {config?.tokenImageUrl ? (
              <img id="token-logo" src={config.tokenImageUrl} alt="Token Logo" />
            ) : (
              <div id="token-logo" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3rem" }}>🪙</div>
            )}
            <div className="token-info">
              <h1>{(config?.tokenName || "LOADING").toUpperCase()}</h1>
              <div className="token-mint">{mintDisplay}</div>
              <span className="symbol-badge">${data.symbol || "—"}</span>
            </div>
          </div>
          <div className="header-badges">
            <div className="badge live">
              <div className="live-dot" />
              LIVE
            </div>
            <a href="/api/admin.html" className="admin-link">⚙ ADMIN</a>
          </div>
        </header>

        {/* Stats */}
        <div className="stats-grid">
          <StatCard label="Holders" value={fmtNum(data.holders)} sub="Estimated holders" />
          <StatCard label="Market Cap" value={fmtUSD(data.usdMarketCap)} sub="USD via Dexscreener" />
          <StatCard label="Price" value={fmtPrice(data.price)} sub="USD per token" />
          <StatCard
            label="Bonding"
            value={data.bondingProgress != null ? data.bondingProgress.toFixed(1) + "%" : "—"}
            sub="To graduation"
          >
            <div className="bonding-bar">
              <div className="bonding-fill" style={{ width: `${Math.min(100, data.bondingProgress ?? 0)}%` }} />
            </div>
          </StatCard>
        </div>

        {/* Chart */}
        <div className="chart-section">
          <div className="chart-panel">
            <div className="chart-panel-header">
              <div className="panel-title">
                <div className="live-dot chart-dot" />
                DEX CHART
              </div>
              <a
                href={chartMint ? `https://dexscreener.com/solana/${chartMint}` : "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="chart-ext-link"
              >
                ↗ DEXSCREENER
              </a>
            </div>
            <div className="chart-iframe-wrap">
              <div className="chart-corner tl" />
              <div className="chart-corner tr" />
              <div className="chart-corner bl" />
              <div className="chart-corner br" />
              <div className={`chart-loading${chartLoaded ? " hidden" : ""}`}>
                <div className="chart-loading-spinner" />
                <div className="chart-loading-text">Loading chart…</div>
              </div>
              {dexUrl && (
                <iframe
                  id="dex-iframe"
                  src={dexUrl}
                  title="Dexscreener Chart"
                  style={{ colorScheme: "dark" }}
                  onLoad={() => setChartLoaded(true)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="main-content">
          {/* Trade stream */}
          <div className="trade-panel">
            <div className="panel-header">
              <div className="panel-title">
                <div className="live-dot trade-dot" />
                LIVE TRADE STREAM
              </div>
              <div className="trade-count">{trades.length} trades</div>
            </div>
            <div className="trade-list">
              {trades.length === 0 ? (
                <div className="no-trades">Waiting for trades…</div>
              ) : (
                trades.map(t => <TradeRow key={t.id} trade={t} />)
              )}
            </div>
          </div>

          {/* Side panel */}
          <div className="side-panel">
            <div className="info-card">
              <h3>Token Info</h3>
              <div className="info-row">
                <span className="info-key">Name</span>
                <span className="info-val">{config?.tokenName || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Symbol</span>
                <span className="info-val">{data.symbol ? "$" + data.symbol : "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Last Updated</span>
                <span className="info-val">{lastUpdateTime}</span>
              </div>
            </div>

            <div className="buy-sell-card">
              <h3>Buy / Sell Pressure</h3>
              <div className="ratio-bar">
                <div className="ratio-fill-buy" style={{ width: `${buyPct}%` }} />
              </div>
              <div className="ratio-labels">
                <span className="ratio-buy">BUY {total > 0 ? buyPct + "%" : "—"}</span>
                <span className="ratio-sell">SELL {total > 0 ? (100 - buyPct) + "%" : "—"}</span>
              </div>
            </div>

            <div className="info-card">
              <h3>Volume (streamed)</h3>
              <div className="info-row">
                <span className="info-key">Buy Volume</span>
                <span className="info-val">{total > 0 ? buyVol.toFixed(3) + " SOL" : "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Sell Volume</span>
                <span className="info-val">{total > 0 ? sellVol.toFixed(3) + " SOL" : "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Net Flow</span>
                <span className="info-val" style={{ color: net >= 0 ? "var(--buy)" : "var(--sell)" }}>
                  {total > 0 ? (net >= 0 ? "+" : "") + net.toFixed(3) + " SOL" : "—"}
                </span>
              </div>
              <div className="info-row">
                <span className="info-key">Trade Count</span>
                <span className="info-val">{trades.length} trades</span>
              </div>
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="status-bar">
          <div className="conn-status">
            <div className={`conn-dot ${connState}`} />
            <span>{connLabel}</span>
          </div>
          <div>LAST UPDATE: {lastUpdateTime}</div>
          <div>TOKEN TELEMETRY · POWERED BY DEXSCREENER</div>
        </div>
      </div>
    </>
  );
}
