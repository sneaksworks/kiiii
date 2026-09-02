/* wicklab snapshot
   Real numbers or n/a. Nothing here is invented. */
(() => {
  const WL = window.WL;
  const { $, state } = WL;

  const els = {
    panel: $("snapshot"),
    name: $("snap-name"),
    meta: $("snap-meta"),
    market: $("snap-market"),
    rangeLow: $("snap-range-low"),
    rangeHigh: $("snap-range-high"),
    rangeFill: $("snap-range-fill"),
    rangeMarker: $("snap-range-marker"),
    rangeWrap: $("snap-range"),
    tiles: $("snap-tiles"),
    note: $("snap-note"),
  };

  let loadId = 0;

  const num = (v) => {
    const n = typeof v === "string" ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : null;
  };

  function fmtBig(v) {
    const n = num(v);
    if (n === null) return "n/a";
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toFixed(2);
  }

  const fmtNum = (v, digits = 2) => {
    const n = num(v);
    return n === null ? "n/a" : n.toFixed(digits);
  };

  const fmtPctRaw = (v) => {
    const n = num(v);
    return n === null ? "n/a" : WL.fmtPct(n);
  };

  function fmtDate(str) {
    if (!str) return "n/a";
    const d = new Date(str + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) return str;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  // Realized volatility from whatever bars are on the chart
  function volatilityFromCandles(candles, tf) {
    const closes = candles.slice(-31).map((c) => c.close);
    if (closes.length < 10) return null;
    const rets = [];
    for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const v = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
    const sd = Math.sqrt(v);
    if (tf === "1D") return { value: sd * Math.sqrt(252) * 100, label: "Volatility (annualized)" };
    if (tf === "1W") return { value: sd * Math.sqrt(52) * 100, label: "Volatility (annualized)" };
    return { value: sd * 100, label: `Volatility (per ${tf} bar)` };
  }

  function tile(label, value, cls = "") {
    return `<div class="snap-tile ${cls}"><span class="snap-label">${label}</span><span class="snap-value">${value}</span></div>`;
  }

  function nextEarnings(data) {
    if (!data || !Array.isArray(data.earnings) || !data.earnings.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const future = data.earnings.filter((e) => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    if (future.length) return { label: "Next earnings", value: fmtDate(future[0].date) };
    const past = data.earnings.filter((e) => e.date && e.date < today).sort((a, b) => b.date.localeCompare(a.date));
    if (!past.length) return null;
    const p = past[0];
    const eps = num(p.eps_actual);
    const est = num(p.eps_estimate);
    const detail = eps !== null && est !== null ? ` (EPS ${eps.toFixed(2)} vs ${est.toFixed(2)} est.)` : "";
    return { label: "Last earnings", value: fmtDate(p.date) + detail };
  }

  function renderSkeleton(symbol) {
    els.panel.classList.remove("hidden");
    els.panel.classList.add("is-loading");
    els.name.textContent = symbol;
    els.meta.textContent = "";
    els.market.textContent = "";
    els.market.className = "snap-market";
    els.note.textContent = "";
    els.rangeWrap.classList.add("hidden");
    els.tiles.innerHTML = Array.from({ length: 8 }, () => `<div class="snap-tile skeleton-tile"></div>`).join("");
  }

  function render(symbol, quote, profile, stats, earnings) {
    els.panel.classList.remove("is-loading");
    const q = quote || {};
    els.name.textContent = q.name || (profile && profile.name) || symbol;
    const metaBits = [q.exchange, q.currency, profile && profile.sector, profile && profile.industry].filter(Boolean);
    els.meta.textContent = metaBits.join("  /  ");

    if (typeof q.is_market_open === "boolean") {
      els.market.textContent = q.is_market_open ? "Market open" : "Market closed";
      els.market.className = "snap-market " + (q.is_market_open ? "open" : "closed");
    }

    const price = num(q.close) ?? (state.candles.length ? state.candles[state.candles.length - 1].close : null);
    const f52 = q.fifty_two_week || {};
    const low52 = num(f52.low);
    const high52 = num(f52.high);
    if (price !== null && low52 !== null && high52 !== null && high52 > low52) {
      const pos = Math.max(0, Math.min(1, (price - low52) / (high52 - low52)));
      els.rangeWrap.classList.remove("hidden");
      els.rangeLow.textContent = WL.fmtPrice(low52);
      els.rangeHigh.textContent = WL.fmtPrice(high52);
      requestAnimationFrame(() => {
        els.rangeFill.style.width = `${(pos * 100).toFixed(1)}%`;
        els.rangeMarker.style.left = `${(pos * 100).toFixed(1)}%`;
      });
    } else {
      els.rangeWrap.classList.add("hidden");
    }

    const vol = volatilityFromCandles(state.candles, state.tf);
    const s = (stats && stats.statistics) || {};
    const val = s.valuations_metrics || {};
    const div = s.dividends_and_splits || {};
    const fin = s.financials || {};
    const earn = nextEarnings(earnings);

    const tiles = [
      tile("Open", fmtNum(q.open)),
      tile("Day range", q.low && q.high ? `${fmtNum(q.low)} to ${fmtNum(q.high)}` : "n/a"),
      tile("Previous close", fmtNum(q.previous_close)),
      tile("Volume", fmtBig(q.volume)),
      tile("Average volume", fmtBig(q.average_volume)),
      tile("From 52 week high", fmtPctRaw(f52.high_change_percent), num(f52.high_change_percent) < 0 ? "down" : ""),
      tile(vol ? vol.label : "Volatility", vol ? `${vol.value.toFixed(2)}%` : "n/a"),
      tile("Market cap", fmtBig(val.market_capitalization)),
      tile("P/E (trailing)", fmtNum(val.trailing_pe)),
      tile("Dividend yield", div.forward_annual_dividend_yield != null ? `${(num(div.forward_annual_dividend_yield) * 100).toFixed(2)}%` : "n/a"),
      tile("Profit margin", fin.profit_margin != null ? `${(num(fin.profit_margin) * 100).toFixed(1)}%` : "n/a"),
      tile(earn ? earn.label : "Next earnings", earn ? earn.value : "n/a"),
    ];
    els.tiles.innerHTML = tiles.map((t, i) => t.replace('class="snap-tile', `style="animation-delay:${i * 45}ms" class="snap-tile`)).join("");

    const blocked = ["profile", "statistics", "earnings"].filter((e) => WL.api.planBlocked(e));
    if (!quote) {
      els.note.textContent = "Quote data was unavailable for this ticker, so only figures derived from the chart are shown.";
    } else if (blocked.length) {
      els.note.textContent = "Fundamentals and earnings need a paid Twelve Data plan, so those fields show n/a. Everything else is live.";
    } else {
      els.note.textContent = "";
    }
  }

  async function load(symbol) {
    const myLoad = ++loadId;
    const cancelled = () => myLoad !== loadId;
    renderSkeleton(symbol);

    let quote = null;
    try {
      quote = await WL.api.fetchQuote(symbol, cancelled);
    } catch (err) {
      if (!err.cancelled) console.warn("quote failed", err);
    }
    if (cancelled()) return;

    // Possibly paid endpoints. Each is tried once per session and skipped
    // for good after a refusal. Sequential so they never burst the rate budget.
    const extra = [];
    for (const fn of [WL.api.fetchProfile, WL.api.fetchStatistics, WL.api.fetchEarnings]) {
      try {
        extra.push(await fn(symbol, cancelled));
      } catch (err) {
        if (err.cancelled) return;
        console.warn("optional endpoint failed", err);
        extra.push(null);
      }
      if (cancelled()) return;
    }
    render(symbol, quote, extra[0], extra[1], extra[2]);
  }

  WL.snapshot = { load };
})();
