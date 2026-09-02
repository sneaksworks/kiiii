/* wicklab api
   All Twelve Data calls go through here so the free plan's
   8 requests per minute limit is respected in one place. */
(() => {
  const WL = window.WL;
  const cache = new Map();
  const credits = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function pruneCredits() {
    const cutoff = Date.now() - 60 * 1000;
    while (credits.length && credits[0] < cutoff) credits.shift();
  }

  // Returns how long to wait before `count` more credits fit in the window
  function waitFor(count) {
    pruneCredits();
    if (credits.length + count <= WL.RATE_LIMIT_PER_MIN) return 0;
    const need = credits.length + count - WL.RATE_LIMIT_PER_MIN;
    const releaseAt = credits[Math.min(need, credits.length) - 1] + 60 * 1000;
    return Math.max(0, releaseAt - Date.now()) + 150;
  }

  async function request(url, count, cancelled) {
    const wait = waitFor(count);
    if (wait > 0) {
      if (WL.onRateWait) WL.onRateWait(wait);
      await sleep(wait);
      if (cancelled && cancelled()) {
        const err = new Error("cancelled");
        err.cancelled = true;
        throw err;
      }
    }
    for (let i = 0; i < count; i++) credits.push(Date.now());
    const response = await fetch(url);
    return response.json();
  }

  function toUnix(datetime, intraday) {
    const iso = intraday ? datetime.replace(" ", "T") + "Z" : datetime + "T00:00:00Z";
    return Math.floor(Date.parse(iso) / 1000);
  }

  function apiError(data, fallback) {
    const err = new Error(data.message || fallback);
    err.code = data.code;
    err.fromApi = true;
    return err;
  }

  function parseSeries(data, intraday) {
    const seen = new Set();
    const candles = [];
    for (const v of data.values.slice().reverse()) {
      const time = toUnix(v.datetime, intraday);
      if (!Number.isFinite(time) || seen.has(time)) continue;
      seen.add(time);
      candles.push({
        time,
        open: +v.open,
        high: +v.high,
        low: +v.low,
        close: +v.close,
        volume: v.volume ? +v.volume : 0,
      });
    }
    candles.sort((a, b) => a.time - b.time);
    return candles;
  }

  function seriesUrl(symbols, interval, outputsize) {
    return (
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbols.join(","))}` +
      `&interval=${interval}&outputsize=${outputsize}&apikey=${WL.API_KEY}`
    );
  }

  async function fetchCandles(symbol, tf, cancelled) {
    const key = `series|${symbol}|${tf}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60 * 1000) return hit.data;

    const cfg = WL.INTERVALS[tf];
    const data = await request(seriesUrl([symbol], cfg.api, WL.BARS), 1, cancelled);
    if (data.status === "error" || !Array.isArray(data.values)) throw apiError(data, "Ticker not found");

    const candles = parseSeries(data, cfg.intraday);
    cache.set(key, { at: Date.now(), data: candles });
    return candles;
  }

  // Daily closes for several symbols in one request. Returns { SYMBOL: candles | null }
  async function fetchBatchDaily(symbols, outputsize = 30) {
    const out = {};
    const need = [];
    for (const s of symbols) {
      const hit = cache.get(`daily30|${s}`);
      if (hit && Date.now() - hit.at < 120 * 1000) out[s] = hit.data;
      else need.push(s);
    }
    if (!need.length) return out;

    const data = await request(seriesUrl(need, "1day", outputsize), need.length);
    if (data.status === "error" && !data.values) throw apiError(data, "Watchlist request failed");

    // A single symbol comes back flat, several come back keyed by symbol
    const entries = Array.isArray(data.values) ? { [need[0]]: data } : data;
    for (const s of need) {
      const entry = entries[s];
      if (entry && Array.isArray(entry.values)) {
        const candles = parseSeries(entry, false);
        cache.set(`daily30|${s}`, { at: Date.now(), data: candles });
        out[s] = candles;
      } else {
        out[s] = null;
      }
    }
    return out;
  }

  // Lets the chart hand its own daily data to the watchlist so no credit is spent twice
  function primeDaily(symbol, candles) {
    cache.set(`daily30|${symbol}`, { at: Date.now(), data: candles.slice(-30) });
  }

  function friendlyError(err, symbol) {
    if (err.code === 429) return "Twelve Data's free plan allows 8 requests a minute. Wait a moment and try again.";
    if (err.code === 401) return "The API key was rejected. Check the key in config.js.";
    if (err.fromApi) {
      if (/not found|invalid|symbol/i.test(err.message)) return `Could not find "${symbol}". Check the ticker and try again.`;
      return err.message;
    }
    if (err && err.name === "TypeError") return "Network error. Check your connection and try again.";
    return "The data loaded but drawing the chart failed. Open the browser console for details.";
  }

  /* ---------- snapshot endpoints ---------- */

  // Endpoints the current plan has refused, so we stop asking for the session
  const unavailable = new Set();
  const isPlanError = (data) => data.status === "error" && (data.code === 403 || /plan|upgrade|subscription/i.test(data.message || ""));

  async function fetchEndpoint(endpoint, symbol, cancelled) {
    if (unavailable.has(endpoint)) return null;
    const key = `${endpoint}|${symbol}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;

    const url = `https://api.twelvedata.com/${endpoint}?symbol=${encodeURIComponent(symbol)}&apikey=${WL.API_KEY}`;
    const data = await request(url, 1, cancelled);
    if (isPlanError(data)) {
      unavailable.add(endpoint);
      return null;
    }
    if (data.status === "error") throw apiError(data, `${endpoint} request failed`);
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  const fetchQuote = (symbol, cancelled) => fetchEndpoint("quote", symbol, cancelled);
  const fetchProfile = (symbol, cancelled) => fetchEndpoint("profile", symbol, cancelled);
  const fetchStatistics = (symbol, cancelled) => fetchEndpoint("statistics", symbol, cancelled);
  const fetchEarnings = (symbol, cancelled) => fetchEndpoint("earnings", symbol, cancelled);
  const planBlocked = (endpoint) => unavailable.has(endpoint);

  WL.api = {
    fetchCandles, fetchBatchDaily, primeDaily, friendlyError, toUnix,
    fetchQuote, fetchProfile, fetchStatistics, fetchEarnings, planBlocked,
  };
})();
