/* wicklab news
   Company headlines from Finnhub. Tries the browser directly, falls back
   to a proxy URL if one is configured. Every string from the feed is
   inserted as text, never as HTML. */
(() => {
  const WL = window.WL;
  const { $, state } = WL;
  const DAYS_BACK = 14;
  const MAX_ITEMS = 14;
  const cache = new Map();

  const els = {
    tabs: $("info-tabs"),
    snapshotTab: $("tab-snapshot"),
    newsTab: $("tab-news"),
    snapshotContent: $("snapshot-content"),
    news: $("news"),
    list: $("news-list"),
    note: $("news-note"),
    refresh: $("news-refresh"),
  };

  let activeTab = "snapshot";
  let loadedFor = null;
  let loadId = 0;

  /* ---------- fetching ---------- */

  function isoDaysAgo(days) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }

  function buildUrl(symbol) {
    const from = isoDaysAgo(DAYS_BACK);
    const to = isoDaysAgo(0);
    if (WL.NEWS_PROXY) {
      const base = WL.NEWS_PROXY.replace(/\/+$/, "");
      return `${base}?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`;
    }
    return `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(WL.FINNHUB_KEY)}`;
  }

  async function fetchNews(symbol) {
    const hit = cache.get(symbol);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.items;

    const response = await fetch(buildUrl(symbol));
    if (response.status === 401 || response.status === 403) {
      const err = new Error("Finnhub rejected the key.");
      err.kind = "auth";
      throw err;
    }
    if (response.status === 429) {
      const err = new Error("Finnhub rate limit hit. Try again in a minute.");
      err.kind = "rate";
      throw err;
    }
    if (!response.ok) throw new Error(`News request failed (${response.status}).`);

    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Unexpected news response.");

    const items = data
      .filter((n) => n && n.headline && n.url)
      .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
      .slice(0, MAX_ITEMS);
    cache.set(symbol, { at: Date.now(), items });
    return items;
  }

  /* ---------- rendering ---------- */

  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

  function timeAgo(unix) {
    if (!unix) return "";
    const diff = Math.max(0, Date.now() / 1000 - unix);
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderItems(items) {
    els.list.replaceChildren();
    if (!items.length) {
      els.list.appendChild(el("div", "side-empty", `No news in the last ${DAYS_BACK} days for ${state.symbol}.`));
      return;
    }
    items.forEach((n, i) => {
      const card = el("a", "news-card");
      const href = safeUrl(n.url);
      if (href) {
        card.href = href;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
      }
      card.style.animationDelay = `${i * 40}ms`;

      const img = safeUrl(n.image);
      if (img) {
        const thumb = el("div", "news-thumb");
        const image = document.createElement("img");
        image.src = img;
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("error", () => thumb.remove());
        thumb.appendChild(image);
        card.appendChild(thumb);
      }

      const body = el("div", "news-body");
      const meta = el("div", "news-meta");
      meta.appendChild(el("span", "news-source", n.source || "Unknown source"));
      meta.appendChild(el("span", "news-time", timeAgo(n.datetime)));
      body.appendChild(meta);
      body.appendChild(el("div", "news-headline", n.headline));
      if (n.summary) {
        const summary = String(n.summary).replace(/\s+/g, " ").trim();
        body.appendChild(el("div", "news-summary", summary.length > 220 ? summary.slice(0, 217) + "..." : summary));
      }
      card.appendChild(body);
      els.list.appendChild(card);
    });
  }

  function renderSkeleton() {
    els.list.replaceChildren();
    for (let i = 0; i < 5; i++) els.list.appendChild(el("div", "news-card skeleton-tile"));
  }

  function setNote(text, kind) {
    els.note.textContent = text;
    els.note.className = "news-note" + (kind ? ` ${kind}` : "");
    els.note.classList.toggle("hidden", !text);
  }

  function explain(err) {
    if (err.kind === "auth") return "Finnhub rejected the key. Check FINNHUB_KEY in config.js.";
    if (err.kind === "rate") return err.message;
    if (err && err.name === "TypeError") {
      return WL.NEWS_PROXY
        ? "Could not reach the news proxy. Check NEWS_PROXY in config.js and that the worker is deployed."
        : "The browser was blocked from reaching Finnhub directly (this is the CORS case). Deploy the Cloudflare Worker and set NEWS_PROXY in config.js.";
    }
    return err.message || "Could not load news.";
  }

  /* ---------- loading ---------- */

  async function load(force = false) {
    const symbol = state.symbol;
    if (!symbol) return;
    if (!WL.FINNHUB_KEY && !WL.NEWS_PROXY) {
      els.list.replaceChildren();
      setNote("News needs a free Finnhub key. Sign up at finnhub.io and paste it into FINNHUB_KEY in config.js.", "setup");
      return;
    }
    if (!force && loadedFor === symbol) return;

    const myLoad = ++loadId;
    if (force) cache.delete(symbol);
    setNote("");
    renderSkeleton();
    els.refresh.classList.add("spinning");
    try {
      const items = await fetchNews(symbol);
      if (myLoad !== loadId) return;
      loadedFor = symbol;
      renderItems(items);
    } catch (err) {
      if (myLoad !== loadId) return;
      els.list.replaceChildren();
      setNote(explain(err), "error");
      console.error(err);
    } finally {
      if (myLoad === loadId) els.refresh.classList.remove("spinning");
    }
  }

  function setTab(tab) {
    activeTab = tab;
    els.snapshotTab.classList.toggle("active", tab === "snapshot");
    els.newsTab.classList.toggle("active", tab === "news");
    els.snapshotTab.setAttribute("aria-selected", String(tab === "snapshot"));
    els.newsTab.setAttribute("aria-selected", String(tab === "news"));
    els.snapshotContent.classList.toggle("hidden", tab !== "snapshot");
    els.news.classList.toggle("hidden", tab !== "news");
    if (tab === "news") load();
  }

  // Called by the chart whenever a new symbol finishes loading
  function onSymbol() {
    if (activeTab === "news") load();
  }

  els.snapshotTab.addEventListener("click", () => setTab("snapshot"));
  els.newsTab.addEventListener("click", () => setTab("news"));
  els.refresh.addEventListener("click", () => load(true));

  WL.news = { load, setTab, onSymbol };
})();
