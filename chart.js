/* wicklab chart */
(() => {
  const WL = window.WL;
  const { $, COLORS: C, INDICATORS, INTERVALS, state } = WL;

  const els = {
    searchBtn: $("search-btn"),
    input: $("ticker-input"),
    status: $("status-message"),
    statusPill: $("status-pill"),
    timeframes: $("timeframes"),
    indicatorToggle: $("indicator-toggle"),
    indicatorPanel: $("indicator-panel"),
    indicatorCount: $("indicator-count"),
    volumeToggle: $("volume-toggle"),
    chartPanel: $("chart-panel"),
    chartHeader: $("chart-header"),
    symbol: $("chart-symbol"),
    star: $("star-btn"),
    fullscreen: $("fullscreen-btn"),
    price: $("chart-price"),
    change: $("chart-change"),
    bias: $("stat-bias"),
    biasBar: $("bias-bar"),
    trend: $("stat-trend"),
    vol: $("stat-vol"),
    signal: $("stat-signal"),
    skeleton: $("skeleton"),
    emptyState: $("empty-state"),
    chartContainer: $("chart-container"),
    legend: $("legend"),
  };

  const view = {
    chart: null,
    candleSeries: null,
    volumeSeries: null,
    indicatorSeries: [],
    markers: [],
    lockRange: null,
    loadId: 0,
    renderId: 0,
    lastShownPrice: null,
  };

  /* ---------- chart ---------- */

  function initChart() {
    view.chart = LightweightCharts.createChart(els.chartContainer, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: C.muted,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(154, 148, 174, 0.07)" },
        horzLines: { color: "rgba(154, 148, 174, 0.07)" },
      },
      rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.08, bottom: 0.25 } },
      timeScale: { borderColor: C.border, rightOffset: 4, timeVisible: false, secondsVisible: false },
      crosshair: {
        vertLine: { color: "rgba(110, 86, 247, 0.45)", labelBackgroundColor: C.accent },
        horzLine: { color: "rgba(110, 86, 247, 0.45)", labelBackgroundColor: C.accent },
      },
      watermark: {
        visible: true,
        text: "wicklab",
        color: "rgba(110, 86, 247, 0.09)",
        fontSize: 64,
        fontFamily: "'Space Grotesk', sans-serif",
        horzAlign: "center",
        vertAlign: "center",
      },
    });

    view.candleSeries = view.chart.addCandlestickSeries({
      upColor: C.up,
      downColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      borderVisible: false,
      autoscaleInfoProvider: (original) => (view.lockRange ? { priceRange: view.lockRange } : original()),
    });

    view.volumeSeries = view.chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    view.chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  }

  function futureTimes(lastTime, count, tf) {
    const cfg = INTERVALS[tf];
    const out = [];
    let t = lastTime;
    for (let i = 0; i < count; i++) {
      t += cfg.seconds;
      if (cfg.api === "1day") {
        while ([0, 6].includes(new Date(t * 1000).getUTCDay())) t += 86400;
      }
      out.push(t);
    }
    return out;
  }

  /* ---------- loading ---------- */

  function setLoading(on, label) {
    els.searchBtn.disabled = on;
    els.chartPanel.classList.toggle("is-loading", on);
    els.skeleton.classList.toggle("hidden", !(on && !view.chart));
    els.emptyState.classList.toggle("hidden", on || !!view.chart);
    els.statusPill.textContent = label;
    els.statusPill.className = "status-pill " + (on ? "loading" : label === "Ready" ? "ready" : "");
  }

  WL.onRateWait = (ms) => {
    els.statusPill.textContent = `Rate limit, waiting ${Math.ceil(ms / 1000)}s`;
  };

  async function loadSymbol(symbol, tf) {
    if (state.mode === "paper" && WL.paper && !WL.paper.canSwitch(symbol, tf)) {
      const s = WL.paper.getSession();
      setTimeframe(s ? s.tf : state.tf);
      if (s && els.input) els.input.value = s.symbol;
      return;
    }
    const myLoad = ++view.loadId;
    els.status.textContent = "";
    setLoading(true, `Loading ${symbol} ${tf}`);

    let candles;
    try {
      candles = await WL.api.fetchCandles(symbol, tf, () => myLoad !== view.loadId);
    } catch (err) {
      if (myLoad !== view.loadId || err.cancelled) return;
      setLoading(false, view.chart ? "Ready" : "Idle");
      els.status.textContent = WL.api.friendlyError(err, symbol);
      console.error(err);
      return;
    }
    if (myLoad !== view.loadId) return;

    try {
      state.symbol = symbol;
      state.tf = tf;
      state.allCandles = candles;

      els.chartContainer.classList.remove("hidden");
      els.chartHeader.classList.remove("hidden");
      if (!view.chart) initChart();
      view.chart.timeScale().applyOptions({ timeVisible: INTERVALS[tf].intraday });

      setLoading(false, "Ready");
      syncStar();
      if (WL.watchlist) {
        WL.watchlist.addRecent(symbol);
        WL.watchlist.rememberLast(symbol, tf);
        WL.watchlist.renderWatchlist();
        if (tf === "1D") WL.watchlist.noteDaily(symbol, candles);
      }

      if (state.mode === "paper" && WL.paper) {
        WL.paper.begin(candles);
        return;
      }

      if (WL.snapshot) {
        clearTimeout(view.snapshotTimer);
        view.snapshotTimer = setTimeout(() => {
          if (myLoad !== view.loadId) return;
          WL.snapshot.load(symbol);
          if (WL.news) WL.news.onSymbol();
        }, 900);
      }
      await applySlice(candles, { animate: true });
    } catch (err) {
      setLoading(false, "Idle");
      els.status.textContent = WL.api.friendlyError(err, symbol);
      console.error(err);
    }
  }

  // Sets the bars the chart should treat as "now" and redraws everything.
  // Live mode passes every bar; replay passes a growing slice.
  async function applySlice(candles, { animate = true, focusEnd = false, rollPrice = true } = {}) {
    state.candles = candles;
    state.probs = Indicators.knnProbabilities(candles);
    state.st = Indicators.superTrend(candles);
    updateStats(rollPrice);
    await renderAll({ animate, focusEnd });
  }

  /* ---------- rendering ---------- */

  function reveal(series, data, { duration = 700, delay = 0, renderId, animate = true } = {}) {
    if (!animate || WL.reducedMotion() || data.length < 2) {
      series.setData(data);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const n = data.length;
      const blanks = data.map((d) => ({ time: d.time }));
      let start = null;
      const step = (now) => {
        if (renderId !== view.renderId) return resolve();
        if (start === null) start = now + delay;
        const t = Math.min(1, Math.max(0, (now - start) / duration));
        const eased = 1 - Math.pow(1 - t, 3);
        const count = Math.round(eased * n);
        series.setData(data.slice(0, count).concat(blanks.slice(count)));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function lineData(times, values) {
    return values.map((v, i) => (v === null || v === undefined ? { time: times[i] } : { time: times[i], value: v }));
  }

  function splitByFlag(times, values, isUp, connect) {
    const up = [];
    const down = [];
    for (let i = 0; i < times.length; i++) {
      const v = values[i];
      if (v === null || v === undefined || isUp[i] === null) {
        up.push({ time: times[i] });
        down.push({ time: times[i] });
        continue;
      }
      const prevUp = i > 0 ? isUp[i - 1] : isUp[i];
      if (isUp[i]) {
        up.push({ time: times[i], value: v });
        down.push(connect && prevUp === false ? { time: times[i], value: v } : { time: times[i] });
      } else {
        down.push({ time: times[i], value: v });
        up.push(connect && prevUp === true ? { time: times[i], value: v } : { time: times[i] });
      }
    }
    return { up, down };
  }

  function buildVolumeData() {
    const vb = state.active.has("volbreak") ? Indicators.volumeBreakouts(state.candles) : null;
    return state.candles.map((c, i) => {
      const up = c.close >= c.open;
      let color = up ? "rgba(52, 211, 153, 0.28)" : "rgba(248, 113, 113, 0.28)";
      if (vb && vb.spikes.has(i)) color = up ? "rgba(52, 211, 153, 0.9)" : "rgba(248, 113, 113, 0.9)";
      return { time: c.time, value: c.volume, color };
    });
  }

  function buildIndicatorLayers() {
    const { candles, probs, st } = state;
    const { chart } = view;
    const times = candles.map((c) => c.time);
    const closes = candles.map((c) => c.close);
    const layers = [];
    const LS = LightweightCharts.LineStyle;

    const addLine = (opts, data) => {
      const series = chart.addLineSeries({
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        ...opts,
      });
      view.indicatorSeries.push(series);
      layers.push({ series, data });
    };

    let lastProb = 0.5;
    for (let i = probs.length - 1; i >= 0; i--) {
      if (probs[i] !== null) { lastProb = probs[i]; break; }
    }

    if (state.active.has("bands")) {
      const bb = Indicators.bollinger(closes, 20, 2);
      addLine({ color: C.bands, lineWidth: 1, lineStyle: LS.Dashed }, lineData(times, bb.upper));
      addLine({ color: "rgba(192, 132, 252, 0.45)", lineWidth: 1, lineStyle: LS.Dotted }, lineData(times, bb.mid));
      addLine({ color: C.bands, lineWidth: 1, lineStyle: LS.Dashed }, lineData(times, bb.lower));
    }

    if (state.active.has("ma")) {
      const fast = Indicators.ema(closes, 9);
      const slow = Indicators.ema(closes, 21);
      const isUp = fast.map((f, i) => {
        if (f === null || slow[i] === null) return null;
        return probs[i] === null ? f >= slow[i] : probs[i] >= 0.5;
      });
      const split = splitByFlag(times, fast, isUp, true);
      addLine({ color: C.maSlow, lineWidth: 1, lineStyle: LS.Dotted }, lineData(times, slow));
      addLine({ color: C.up, lineWidth: 2 }, split.up);
      addLine({ color: C.down, lineWidth: 2 }, split.down);
      for (let i = 1; i < times.length; i++) {
        if (fast[i] === null || slow[i - 1] === null) continue;
        const crossUp = fast[i - 1] <= slow[i - 1] && fast[i] > slow[i];
        const crossDown = fast[i - 1] >= slow[i - 1] && fast[i] < slow[i];
        if (crossUp || crossDown) {
          view.markers.push({ time: times[i], position: crossUp ? "belowBar" : "aboveBar", color: C.ma, shape: "circle", size: 0.6 });
        }
      }
    }

    if (state.active.has("supertrend")) {
      const isUp = st.trend.map((t) => (t === null ? null : t === 1));
      const split = splitByFlag(times, st.line, isUp, false);
      addLine({ color: C.up, lineWidth: 2 }, split.up);
      addLine({ color: C.down, lineWidth: 2 }, split.down);
      for (const f of st.flips) {
        const p = probs[f.index];
        const conf = p === null ? null : Math.round((f.dir === 1 ? p : 1 - p) * 100);
        view.markers.push({
          time: times[f.index],
          position: f.dir === 1 ? "belowBar" : "aboveBar",
          color: f.dir === 1 ? C.up : C.down,
          shape: f.dir === 1 ? "arrowUp" : "arrowDown",
          text: (f.dir === 1 ? "BUY" : "SELL") + (conf === null ? "" : ` ${conf}%`),
          size: 1,
        });
      }
    }

    if (state.active.has("flow")) {
      const curve = Indicators.lsma(closes, 20);
      addLine({ color: "rgba(167, 139, 250, 0.75)", lineWidth: 1, lineStyle: LS.Dashed }, lineData(times, curve));

      const forward = 12;
      const proj = Indicators.projection(closes, { lookback: 30, forward });
      const tilt = (lastProb - 0.5) * proj.sigma * 0.8;
      const last = candles[candles.length - 1];
      const future = futureTimes(last.time, forward, state.tf);

      const center = [{ time: last.time, value: last.close }];
      const upper = [{ time: last.time, value: last.close }];
      const lower = [{ time: last.time, value: last.close }];
      for (let t = 1; t <= forward; t++) {
        const v = proj.center[t - 1] + tilt * t;
        const w = proj.width[t - 1];
        center.push({ time: future[t - 1], value: v });
        upper.push({ time: future[t - 1], value: v + w });
        lower.push({ time: future[t - 1], value: v - w });
      }
      addLine({ color: "rgba(167, 139, 250, 0.4)", lineWidth: 1, lineStyle: LS.SparseDotted }, upper);
      addLine({ color: "rgba(167, 139, 250, 0.4)", lineWidth: 1, lineStyle: LS.SparseDotted }, lower);
      addLine({ color: C.flow, lineWidth: 2, lineStyle: LS.Dashed }, center);
    }

    if (state.active.has("volbreak")) {
      const vb = Indicators.volumeBreakouts(candles);
      for (const e of vb.events) {
        view.markers.push({
          time: times[e.index],
          position: e.dir === 1 ? "belowBar" : "aboveBar",
          color: C.volume,
          shape: "circle",
          text: e.dir === 1 ? "VOL BREAK" : "VOL DROP",
          size: 0.8,
        });
      }
    }

    return layers;
  }

  async function renderAll({ animate = true, focusEnd = false } = {}) {
    if (!view.chart || !state.candles.length) return;
    const renderId = ++view.renderId;
    const { chart, candleSeries, volumeSeries } = view;
    const { candles } = state;

    for (const s of view.indicatorSeries) chart.removeSeries(s);
    view.indicatorSeries = [];
    view.markers = [];
    candleSeries.setMarkers([]);

    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    const pad = (hi - lo) * 0.06;
    view.lockRange = { minValue: lo - pad, maxValue: hi + pad };

    const candleData = candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const volumeData = buildVolumeData();
    const volumeOn = state.showVolume || state.active.has("volbreak");

    volumeSeries.applyOptions({ visible: volumeOn });
    chart.priceScale("right").applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: volumeOn ? 0.25 : 0.06 } });

    const layers = buildIndicatorLayers();

    candleSeries.setData(candleData.map((d) => ({ time: d.time })));
    volumeSeries.setData(volumeData.map((d) => ({ time: d.time })));
    for (const l of layers) l.series.setData(l.data.map((d) => ({ time: d.time })));
    if (focusEnd) focusOnEnd();
    else if (animate) chart.timeScale().fitContent();

    await Promise.all([
      reveal(candleSeries, candleData, { duration: 800, renderId, animate }),
      reveal(volumeSeries, volumeData, { duration: 800, renderId, animate }),
      ...layers.map((l, i) => reveal(l.series, l.data, { duration: 650, delay: 260 + i * 110, renderId, animate })),
    ]);

    if (renderId !== view.renderId) return;
    view.lockRange = null;
    chart.priceScale("right").applyOptions({ autoScale: true });
    refreshMarkers();
    if (focusEnd) focusOnEnd();
    renderLegend();
  }

  // Keeps the newest bars in view with room on the right for the projection
  function focusOnEnd() {
    const n = state.candles.length;
    view.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 110), to: n + 14 });
  }

  function refreshMarkers() {
    if (!view.candleSeries) return;
    const extra = state.mode === "paper" && WL.paper ? WL.paper.markers() : [];
    const all = view.markers.concat(extra).sort((a, b) => a.time - b.time);
    view.candleSeries.setMarkers(all);
  }

  function renderLegend() {
    const chips = [];
    for (const id of Object.keys(INDICATORS)) {
      if (!state.active.has(id)) continue;
      chips.push(`<span class="chip"><i style="background:${INDICATORS[id].color}"></i>${INDICATORS[id].name}</span>`);
    }
    if (state.showVolume || state.active.has("volbreak")) {
      chips.push(`<span class="chip"><i style="background:${C.muted}"></i>Volume</span>`);
    }
    els.legend.innerHTML = chips.join("");
  }

  /* ---------- stats ---------- */

  function updateStats(rollPrice = true) {
    const { candles, probs, st } = state;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2] || last;
    const change = last.close - prev.close;
    const pct = (change / prev.close) * 100;
    const up = change >= 0;

    els.symbol.textContent = state.symbol;
    if (rollPrice) WL.countUp(els.price, view.lastShownPrice ?? last.close * 0.97, last.close, WL.fmtPrice);
    else els.price.textContent = WL.fmtPrice(last.close);
    view.lastShownPrice = last.close;
    els.change.textContent = `${up ? "+" : ""}${change.toFixed(2)} (${WL.fmtPct(pct)})`;
    els.change.className = "chart-change " + (up ? "up" : "down");

    let p = null;
    for (let i = probs.length - 1; i >= 0; i--) {
      if (probs[i] !== null) { p = probs[i]; break; }
    }
    if (p === null) {
      els.bias.textContent = "Warming up";
      els.bias.className = "stat-value";
      els.biasBar.style.width = "0%";
      els.biasBar.className = "bias-fill";
    } else {
      const bull = p >= 0.5;
      const conf = Math.round((bull ? p : 1 - p) * 100);
      els.bias.textContent = `${bull ? "Bullish" : "Bearish"} ${conf}%`;
      els.bias.className = "stat-value " + (bull ? "up" : "down");
      els.biasBar.style.width = `${conf}%`;
      els.biasBar.className = "bias-fill " + (bull ? "up" : "down");
    }

    const t = st.trend[st.trend.length - 1];
    els.trend.textContent = t === 1 ? "Uptrend" : t === -1 ? "Downtrend" : "n/a";
    els.trend.className = "stat-value " + (t === 1 ? "up" : t === -1 ? "down" : "");

    const a = st.atr[st.atr.length - 1];
    els.vol.textContent = a ? `${((a / last.close) * 100).toFixed(2)}% ATR` : "n/a";

    const f = st.flips[st.flips.length - 1];
    if (f) {
      els.signal.textContent = `${f.dir === 1 ? "BUY" : "SELL"} at ${WL.fmtPrice(candles[f.index].close)}`;
      els.signal.className = "stat-value " + (f.dir === 1 ? "up" : "down");
    } else {
      els.signal.textContent = "None yet";
      els.signal.className = "stat-value";
    }
  }

  /* ---------- star ---------- */

  function syncStar() {
    if (!WL.watchlist || !state.symbol) return;
    const on = WL.watchlist.isFavorite(state.symbol);
    els.star.classList.toggle("on", on);
    els.star.setAttribute("aria-pressed", String(on));
    els.star.setAttribute("aria-label", on ? "Remove from watchlist" : "Add to watchlist");
  }

  els.star.addEventListener("click", () => {
    if (!state.symbol || !WL.watchlist) return;
    const ok = WL.watchlist.toggleFavorite(state.symbol);
    if (ok && !WL.reducedMotion()) {
      els.star.classList.remove("pop");
      void els.star.offsetWidth;
      els.star.classList.add("pop");
    }
    syncStar();
  });

  /* ---------- controls ---------- */

  function buildIndicatorPanel() {
    els.indicatorPanel.innerHTML = Object.entries(INDICATORS)
      .map(
        ([id, ind]) => `
        <label class="ind-row">
          <span class="ind-swatch" style="background:${ind.color};color:${ind.color}"></span>
          <span class="ind-text">
            <span class="ind-name">${ind.name}</span>
            <span class="ind-desc">${ind.desc}</span>
          </span>
          <span class="switch">
            <input type="checkbox" data-indicator="${id}" ${state.active.has(id) ? "checked" : ""}>
            <span class="switch-track" aria-hidden="true"></span>
          </span>
        </label>`
      )
      .join("");
    els.indicatorCount.textContent = state.active.size;

    els.indicatorPanel.querySelectorAll("input[data-indicator]").forEach((box) => {
      box.addEventListener("change", () => {
        const id = box.dataset.indicator;
        if (box.checked) state.active.add(id);
        else state.active.delete(id);
        els.indicatorCount.textContent = state.active.size;
        renderAll();
      });
    });
  }

  function setPanelOpen(open) {
    els.indicatorPanel.hidden = !open;
    els.indicatorToggle.setAttribute("aria-expanded", String(open));
  }

  els.indicatorToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setPanelOpen(els.indicatorPanel.hidden);
  });
  els.indicatorPanel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => setPanelOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setPanelOpen(false);
  });

  els.volumeToggle.addEventListener("change", () => {
    state.showVolume = els.volumeToggle.checked;
    renderAll();
  });

  function setTimeframe(tf) {
    state.tf = tf;
    els.timeframes.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tf === tf));
  }

  els.timeframes.querySelectorAll("button[data-tf]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tf = btn.dataset.tf;
      if (tf === state.tf && state.symbol) return;
      setTimeframe(tf);
      if (state.symbol) loadSymbol(state.symbol, tf);
    });
  });

  /* ---------- fullscreen ---------- */

  function setFullscreen(on) {
    els.chartPanel.classList.toggle("fullscreen", on);
    els.fullscreen.setAttribute("aria-pressed", String(on));
    els.fullscreen.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen chart");
    document.body.classList.toggle("has-fullscreen", on);
  }

  els.fullscreen.addEventListener("click", () => {
    const on = !els.chartPanel.classList.contains("fullscreen");
    setFullscreen(on);
    if (on && els.chartPanel.requestFullscreen) {
      els.chartPanel.requestFullscreen().catch(() => {});
    } else if (!on && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) setFullscreen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.chartPanel.classList.contains("fullscreen") && !document.fullscreenElement) setFullscreen(false);
  });

  buildIndicatorPanel();

  WL.chart = { loadSymbol, renderAll, applySlice, refreshMarkers, focusOnEnd, setTimeframe, syncStar, setFullscreen };
})();
