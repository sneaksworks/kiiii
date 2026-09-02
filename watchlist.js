/* wicklab watchlist
   Favorites feed the watchlist. Everything persists in the browser. */
(() => {
  const WL = window.WL;
  const { $ } = WL;

  const KEYS = { fav: "wicklab:favorites", recent: "wicklab:recents", last: "wicklab:last" };
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* private mode or storage disabled, fine */
      }
    },
  };

  const els = {
    sidebar: $("sidebar"),
    backdrop: $("drawer-backdrop"),
    drawerBtn: $("drawer-btn"),
    drawerClose: $("drawer-close"),
    list: $("watchlist"),
    note: $("watchlist-note"),
    refresh: $("watchlist-refresh"),
    updated: $("watchlist-updated"),
    recents: $("recents"),
    favCount: $("fav-count"),
  };

  let favorites = store.get(KEYS.fav, []).filter((s) => typeof s === "string").slice(0, WL.MAX_FAVORITES);
  let recents = store.get(KEYS.recent, []).filter((s) => typeof s === "string").slice(0, WL.MAX_RECENTS);
  const daily = new Map();
  let refreshing = false;
  let timer = null;

  /* ---------- storage ---------- */

  const isFavorite = (s) => favorites.includes(s);

  function toggleFavorite(symbol) {
    if (isFavorite(symbol)) {
      favorites = favorites.filter((s) => s !== symbol);
      store.set(KEYS.fav, favorites);
      renderWatchlist();
      renderRecents();
      return true;
    }
    if (favorites.length >= WL.MAX_FAVORITES) {
      setNote(`Watchlist holds ${WL.MAX_FAVORITES} tickers. Remove one to add another.`);
      return false;
    }
    favorites = [...favorites, symbol];
    store.set(KEYS.fav, favorites);
    setNote("");
    renderWatchlist();
    renderRecents();
    refresh(false);
    return true;
  }

  function addRecent(symbol) {
    recents = [symbol, ...recents.filter((s) => s !== symbol)].slice(0, WL.MAX_RECENTS);
    store.set(KEYS.recent, recents);
    renderRecents();
  }

  const rememberLast = (symbol, tf) => store.set(KEYS.last, { symbol, tf });
  const getLast = () => store.get(KEYS.last, null);

  function noteDaily(symbol, candles) {
    daily.set(symbol, candles.slice(-30));
    WL.api.primeDaily(symbol, candles);
    renderWatchlist();
  }

  /* ---------- rendering ---------- */

  const starSvg = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.8L12 17.7 6 21l1.3-6.8-5-4.7 6.8-.8z" fill="currentColor"/></svg>`;

  function setNote(text) {
    els.note.textContent = text;
    els.note.classList.toggle("hidden", !text);
  }

  function sparkline(closes) {
    const w = 84;
    const h = 26;
    const lo = Math.min(...closes);
    const hi = Math.max(...closes);
    const span = hi - lo || 1;
    const pts = closes
      .map((c, i) => `${((i / (closes.length - 1)) * w).toFixed(1)},${(h - ((c - lo) / span) * (h - 2) - 1).toFixed(1)}`)
      .join(" ");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function renderWatchlist() {
    els.favCount.textContent = favorites.length ? `${favorites.length}/${WL.MAX_FAVORITES}` : "";
    if (!favorites.length) {
      els.list.innerHTML = `<div class="side-empty">Star a ticker to add it here.</div>`;
      return;
    }
    els.list.innerHTML = favorites
      .map((s) => {
        const candles = daily.get(s);
        const isActive = WL.state.symbol === s;
        if (!candles) {
          return `<button type="button" class="watch-row skeleton-row ${isActive ? "active" : ""}" data-symbol="${s}">
            <span class="watch-symbol">${s}</span>
            <span class="watch-loading">loading</span>
            <span class="watch-remove" data-remove="${s}" title="Remove" aria-label="Remove ${s}">&times;</span>
          </button>`;
        }
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2] || last;
        const pct = ((last.close - prev.close) / prev.close) * 100;
        const cls = pct >= 0 ? "up" : "down";
        return `<button type="button" class="watch-row ${cls} ${isActive ? "active" : ""}" data-symbol="${s}">
          <span class="watch-symbol">${s}</span>
          ${sparkline(candles.map((c) => c.close))}
          <span class="watch-price">
            <span class="watch-last">${WL.fmtPrice(last.close)}</span>
            <span class="watch-pct">${WL.fmtPct(pct)}</span>
          </span>
          <span class="watch-remove" data-remove="${s}" title="Remove" aria-label="Remove ${s}">&times;</span>
        </button>`;
      })
      .join("");
  }

  function renderRecents() {
    if (!recents.length) {
      els.recents.innerHTML = `<div class="side-empty">Nothing searched yet.</div>`;
      return;
    }
    els.recents.innerHTML = recents
      .map(
        (s) => `<span class="recent-chip ${WL.state.symbol === s ? "active" : ""}">
          <button type="button" class="recent-load" data-symbol="${s}">${s}</button>
          <button type="button" class="recent-star ${isFavorite(s) ? "on" : ""}" data-star="${s}" aria-label="${isFavorite(s) ? "Remove" : "Add"} ${s} ${isFavorite(s) ? "from" : "to"} watchlist" aria-pressed="${isFavorite(s)}">${starSvg}</button>
        </span>`
      )
      .join("");
  }

  /* ---------- refresh ---------- */

  async function refresh(force) {
    if (refreshing) return;
    const want = force ? favorites.slice() : favorites.filter((s) => !daily.has(s));
    if (!want.length) return;
    refreshing = true;
    els.refresh.classList.add("spinning");
    try {
      const result = await WL.api.fetchBatchDaily(want, 30);
      for (const s of want) {
        if (result[s]) daily.set(s, result[s]);
      }
      const failed = want.filter((s) => !result[s]);
      setNote(failed.length ? `No data for ${failed.join(", ")}.` : "");
      els.updated.textContent = `updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    } catch (err) {
      setNote(WL.api.friendlyError(err, want.join(", ")));
      console.error(err);
    } finally {
      refreshing = false;
      els.refresh.classList.remove("spinning");
      renderWatchlist();
    }
  }

  function scheduleAuto() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden || !favorites.length) return;
      refresh(true);
    }, WL.WATCHLIST_REFRESH_MS);
  }

  /* ---------- drawer ---------- */

  function setDrawer(open) {
    els.sidebar.classList.toggle("open", open);
    els.backdrop.classList.toggle("open", open);
    document.body.classList.toggle("drawer-open", open);
    els.drawerBtn.setAttribute("aria-expanded", String(open));
  }

  /* ---------- events ---------- */

  function loadFromSidebar(symbol) {
    if (!WL.chart) return;
    setDrawer(false);
    if (symbol !== WL.state.symbol) WL.chart.loadSymbol(symbol, WL.state.tf);
  }

  els.list.addEventListener("click", (e) => {
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      e.stopPropagation();
      toggleFavorite(remove.dataset.remove);
      if (WL.chart) WL.chart.syncStar();
      return;
    }
    const row = e.target.closest("[data-symbol]");
    if (row) loadFromSidebar(row.dataset.symbol);
  });

  els.recents.addEventListener("click", (e) => {
    const star = e.target.closest("[data-star]");
    if (star) {
      toggleFavorite(star.dataset.star);
      if (WL.chart) WL.chart.syncStar();
      return;
    }
    const load = e.target.closest("[data-symbol]");
    if (load) loadFromSidebar(load.dataset.symbol);
  });

  els.refresh.addEventListener("click", () => refresh(true));
  els.drawerBtn.addEventListener("click", () => setDrawer(!els.sidebar.classList.contains("open")));
  els.drawerClose.addEventListener("click", () => setDrawer(false));
  els.backdrop.addEventListener("click", () => setDrawer(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setDrawer(false);
  });

  function init() {
    renderWatchlist();
    renderRecents();
    scheduleAuto();
    // let the chart's own request go first so the two never fight over the rate budget
    setTimeout(() => refresh(false), 900);
  }

  WL.watchlist = { isFavorite, toggleFavorite, addRecent, rememberLast, getLast, noteDaily, refresh, init, renderWatchlist, renderRecents };
})();
