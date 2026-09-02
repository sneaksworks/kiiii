/* wicklab config
   Everything shared between files lives on one WL object so load order
   never causes "is not defined" surprises. */
window.WL = window.WL || {};
(() => {
  const WL = window.WL;

  WL.API_KEY = "8b512483caf04a168b28da4791fedaa4";

  // News. Sign up free at finnhub.io and paste the key here.
  WL.FINNHUB_KEY = "";
  // Only needed if the browser gets blocked from reaching Finnhub directly.
  // Leave empty first and see if news loads without it.
  WL.NEWS_PROXY = "";
  WL.BARS = 300;
  WL.MAX_FAVORITES = 6;
  WL.MAX_RECENTS = 8;
  WL.RATE_LIMIT_PER_MIN = 8;
  WL.WATCHLIST_REFRESH_MS = 5 * 60 * 1000;

  WL.INTERVALS = {
    "1m":  { api: "1min",  seconds: 60,     intraday: true },
    "5m":  { api: "5min",  seconds: 300,    intraday: true },
    "15m": { api: "15min", seconds: 900,    intraday: true },
    "1h":  { api: "1h",    seconds: 3600,   intraday: true },
    "4h":  { api: "4h",    seconds: 14400,  intraday: true },
    "1D":  { api: "1day",  seconds: 86400,  intraday: false },
    "1W":  { api: "1week", seconds: 604800, intraday: false },
  };

  WL.COLORS = {
    accent: "#6e56f7",
    up: "#34d399",
    down: "#f87171",
    muted: "#9b94ae",
    border: "#2a2438",
    flow: "#a78bfa",
    ma: "#60a5fa",
    maSlow: "#7dd3fc",
    bands: "#c084fc",
    volume: "#f59e0b",
  };

  WL.INDICATORS = {
    flow:       { name: "AI Predictive Flow",  color: WL.COLORS.flow,   desc: "Regression curve plus a forward cone tilted by the model" },
    supertrend: { name: "AI SuperTrend",       color: WL.COLORS.up,     desc: "ATR trailing line with BUY and SELL flips and confidence" },
    ma:         { name: "AI Moving Average",   color: WL.COLORS.ma,     desc: "Fast and slow EMA, fast line colored by model bias" },
    bands:      { name: "AI Volatility Bands", color: WL.COLORS.bands,  desc: "Dashed volatility channel around price" },
    volbreak:   { name: "AI Volume Breakout",  color: WL.COLORS.volume, desc: "Volume spikes that break the recent range" },
  };

  WL.state = {
    mode: "live",
    symbol: null,
    tf: "1D",
    allCandles: [],
    candles: [],
    probs: [],
    st: null,
    active: new Set(["flow", "supertrend"]),
    showVolume: true,
  };

  WL.$ = (id) => document.getElementById(id);
  WL.reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  WL.fmtPrice = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  WL.fmtPct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  WL.fmtMoney = (v, sign = false) => {
    const body = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v < 0) return "-" + body;
    return (sign ? "+" : "") + body;
  };

  // Rolls a number in an element from one value to another
  WL.countUp = (el, from, to, format, duration = 700) => {
    if (WL.reducedMotion() || from === null || from === undefined || from === to) {
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
})();
