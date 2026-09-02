/* wicklab paper trading
   Bar replay. The future is hidden, indicators only ever see revealed bars,
   trades fill at the current bar's close. Long only, no fees. */
(() => {
  const WL = window.WL;
  const { $, state } = WL;
  const KEY = "wicklab:paper";
  const MODE_KEY = "wicklab:mode";
  const SPEEDS = { 1: 1000, 2: 500, 4: 250 };

  const els = {
    modeToggle: $("mode-toggle"),
    dock: $("paper-dock"),
    play: $("paper-play"),
    step: $("paper-step"),
    speed: $("paper-speed"),
    progressFill: $("paper-progress-fill"),
    bar: $("paper-bar"),
    date: $("paper-date"),
    qty: $("paper-qty"),
    max: $("paper-max"),
    buy: $("paper-buy"),
    sell: $("paper-sell"),
    cash: $("paper-cash"),
    position: $("paper-position"),
    equity: $("paper-equity"),
    equityStat: $("paper-equity-stat"),
    pnl: $("paper-pnl"),
    realized: $("paper-realized"),
    ret: $("paper-return"),
    logToggle: $("paper-log-toggle"),
    logCount: $("paper-log-count"),
    log: $("paper-log"),
    reset: $("paper-reset"),
    balance: $("paper-balance"),
    summary: $("paper-summary"),
    note: $("paper-note"),
    snapshot: $("snapshot"),
    status: $("status-message"),
    mute: $("paper-mute"),
  };

  let full = [];
  let session = null;
  let timer = null;
  let lastEquity = null;
  let audio = null;
  let muted = false;

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
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },
  };

  /* ---------- session ---------- */

  function freshSession(candles, symbol, tf) {
    const n = candles.length;
    const cursor = n >= 220 ? n - 150 : Math.max(20, Math.floor(n * 0.55));
    const startBalance = Math.max(100, Number(els.balance.value) || 10000);
    return {
      symbol,
      tf,
      cursor,
      startTime: candles[cursor].time,
      startPrice: candles[cursor].close,
      startBalance,
      cash: startBalance,
      shares: 0,
      avgCost: 0,
      realized: 0,
      trades: [],
      speed: 1,
      complete: false,
    };
  }

  function save() {
    if (!session) return;
    store.set(KEY, { ...session, cursorTime: full[session.cursor] ? full[session.cursor].time : null });
  }

  function restoreFor(candles, symbol, tf) {
    const saved = store.get(KEY, null);
    if (!saved || saved.symbol !== symbol || saved.tf !== tf) return null;
    const cursor = candles.findIndex((c) => c.time === saved.cursorTime);
    if (cursor < 0) return null;
    const restored = { ...saved, cursor };
    delete restored.cursorTime;
    restored.trades = Array.isArray(restored.trades) ? restored.trades : [];
    return restored;
  }

  const price = () => full[session.cursor].close;
  const equity = () => session.cash + session.shares * price();
  const unrealized = () => session.shares * (price() - session.avgCost);
  const buyHold = () => (session.startBalance / session.startPrice) * price();

  /* ---------- lifecycle ---------- */

  function begin(candles) {
    stop();
    full = candles;
    session = restoreFor(candles, state.symbol, state.tf) || freshSession(candles, state.symbol, state.tf);
    lastEquity = null;
    els.balance.value = session.startBalance;
    els.dock.classList.remove("hidden");
    els.snapshot.classList.add("hidden");
    setSpeedButtons();
    renderLog();
    updatePanel(false);
    WL.chart.applySlice(full.slice(0, session.cursor + 1), { animate: true, focusEnd: true });
    save();
  }

  function step() {
    if (!session || session.complete) return;
    if (session.cursor >= full.length - 1) {
      finish();
      return;
    }
    session.cursor += 1;
    WL.chart.applySlice(full.slice(0, session.cursor + 1), { animate: false, focusEnd: true, rollPrice: false });
    updatePanel(true);
    if (session.cursor >= full.length - 1) finish();
    save();
  }

  function play() {
    if (!session || session.complete) return;
    stop();
    timer = setInterval(step, SPEEDS[session.speed] || 1000);
    els.play.textContent = "Pause";
    els.play.classList.add("active");
    els.dock.classList.add("playing");
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    els.play.textContent = "Play";
    els.play.classList.remove("active");
    els.dock.classList.remove("playing");
  }

  function finish() {
    stop();
    session.complete = true;
    const ret = ((equity() - session.startBalance) / session.startBalance) * 100;
    const bh = ((buyHold() - session.startBalance) / session.startBalance) * 100;
    els.summary.innerHTML =
      `<strong>Replay complete.</strong> You finished at ${WL.fmtMoney(equity())}, ` +
      `<span class="${ret >= 0 ? "up" : "down"}">${WL.fmtPct(ret)}</span>. ` +
      `Buying on bar one and holding would have returned <span class="${bh >= 0 ? "up" : "down"}">${WL.fmtPct(bh)}</span>.`;
    els.summary.classList.remove("hidden");
    sounds.done();
    els.step.disabled = true;
    els.play.disabled = true;
    save();
  }

  function reset() {
    if (!full.length) return;
    if (session && session.trades.length && !window.confirm("Reset the paper session? Your trades will be cleared.")) return;
    stop();
    store.set(KEY, null);
    session = freshSession(full, state.symbol, state.tf);
    lastEquity = null;
    els.summary.classList.add("hidden");
    els.step.disabled = false;
    els.play.disabled = false;
    renderLog();
    updatePanel(false);
    WL.chart.applySlice(full.slice(0, session.cursor + 1), { animate: true, focusEnd: true });
    save();
  }

  // Called by the chart before loading a different symbol or timeframe
  function canSwitch(symbol, tf) {
    if (!session || (session.symbol === symbol && session.tf === tf)) return true;
    if (!session.trades.length) {
      store.set(KEY, null);
      return true;
    }
    const ok = window.confirm(`Switching to ${symbol} ${tf} ends your current paper session on ${session.symbol} ${session.tf}. Continue?`);
    if (ok) {
      stop();
      store.set(KEY, null);
      session = null;
    }
    return ok;
  }

  /* ---------- trading ---------- */

  function trade(side) {
    if (!session || session.complete) return;
    const qty = Math.floor(Number(els.qty.value));
    if (!qty || qty < 1) return flash(els.qty);
    const p = price();
    const t = full[session.cursor].time;

    if (side === "buy") {
      const cost = qty * p;
      if (cost > session.cash + 1e-9) {
        showNote(`Not enough cash. ${qty} shares cost ${WL.fmtMoney(cost)}, you have ${WL.fmtMoney(session.cash)}.`);
        return flash(els.buy);
      }
      session.avgCost = (session.avgCost * session.shares + cost) / (session.shares + qty);
      session.shares += qty;
      session.cash -= cost;
      session.trades.push({ time: t, side, qty, price: p, pnl: null });
      showNote("");
      sounds.buy();
      animateTrade(els.buy, `+${qty} ${session.symbol}`, "up");
    } else {
      if (qty > session.shares) {
        showNote(session.shares ? `You only hold ${session.shares} shares.` : "Nothing to sell yet. Long only, so buy first.");
        return flash(els.sell);
      }
      const pnl = qty * (p - session.avgCost);
      session.realized += pnl;
      session.cash += qty * p;
      session.shares -= qty;
      if (session.shares === 0) session.avgCost = 0;
      session.trades.push({ time: t, side, qty, price: p, pnl });
      showNote("");
      (pnl >= 0 ? sounds.win : sounds.loss)();
      animateTrade(els.sell, WL.fmtMoney(pnl, true), pnl >= 0 ? "up" : "down");
    }

    WL.chart.refreshMarkers();
    renderLog();
    updatePanel(true);
    save();
  }

  function markers() {
    if (!session) return [];
    return session.trades.map((tr) => ({
      time: tr.time,
      position: tr.side === "buy" ? "belowBar" : "aboveBar",
      color: tr.side === "buy" ? "#fbbf24" : tr.pnl >= 0 ? WL.COLORS.up : WL.COLORS.down,
      shape: tr.side === "buy" ? "arrowUp" : "arrowDown",
      text: `${tr.side === "buy" ? "BUY" : "SELL"} ${tr.qty}`,
      size: 1.2,
    }));
  }

  /* ---------- panel ---------- */

  function fmtBarDate(time) {
    const d = new Date(time * 1000);
    const intraday = WL.INTERVALS[session.tf].intraday;
    return intraday
      ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  function updatePanel(animate) {
    if (!session) return;
    const p = price();
    const eq = equity();
    const un = unrealized();
    const ret = ((eq - session.startBalance) / session.startBalance) * 100;

    els.bar.textContent = `Bar ${session.cursor + 1} of ${full.length}`;
    els.date.textContent = fmtBarDate(full[session.cursor].time);
    els.progressFill.style.width = `${((session.cursor + 1) / full.length) * 100}%`;

    els.cash.textContent = WL.fmtMoney(session.cash);
    els.position.textContent = session.shares ? `${session.shares} @ ${WL.fmtPrice(session.avgCost)}` : "None";
    if (animate) WL.countUp(els.equity, lastEquity ?? eq, eq, (v) => WL.fmtMoney(v), 500);
    else els.equity.textContent = WL.fmtMoney(eq);
    lastEquity = eq;

    els.pnl.textContent = session.shares ? WL.fmtMoney(un, true) : WL.fmtMoney(0);
    els.pnl.className = "stat-value " + (session.shares ? (un >= 0 ? "up" : "down") : "");
    els.realized.textContent = WL.fmtMoney(session.realized, true);
    els.realized.className = "stat-value " + (session.realized > 0 ? "up" : session.realized < 0 ? "down" : "");
    els.ret.textContent = WL.fmtPct(ret);
    els.ret.className = "stat-value " + (ret > 0 ? "up" : ret < 0 ? "down" : "");

    els.max.textContent = `Max ${Math.floor(session.cash / p)}`;
    els.sell.disabled = session.shares === 0 || session.complete;
    els.buy.disabled = session.complete;
  }

  function renderLog() {
    if (!session) return;
    els.logCount.textContent = session.trades.length;
    if (!session.trades.length) {
      els.log.innerHTML = `<div class="side-empty">No trades yet.</div>`;
      return;
    }
    els.log.innerHTML = session.trades
      .slice()
      .reverse()
      .map(
        (tr) => `<div class="log-row ${tr.side}">
          <span class="log-side">${tr.side === "buy" ? "BUY" : "SELL"}</span>
          <span class="log-qty">${tr.qty} @ ${WL.fmtPrice(tr.price)}</span>
          <span class="log-time">${fmtBarDate(tr.time)}</span>
          <span class="log-pnl ${tr.pnl === null ? "" : tr.pnl >= 0 ? "up" : "down"}">${tr.pnl === null ? "" : WL.fmtMoney(tr.pnl, true)}</span>
        </div>`
      )
      .join("");
  }

  function showNote(text) {
    els.note.textContent = text;
    els.note.classList.toggle("hidden", !text);
  }

  /* ---------- sound ---------- */

  // Short synthesized chimes. No audio files, nothing to load.
  function tone(freqs, type = "sine", dur = 0.11, volume = 0.16) {
    if (muted) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audio = audio || new Ctx();
      if (audio.state === "suspended") audio.resume();
      const now = audio.currentTime;
      freqs.forEach((f, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = type;
        osc.frequency.value = f;
        const t0 = now + i * dur;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.06);
        osc.connect(gain).connect(audio.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.08);
      });
    } catch {
      /* audio unavailable, stay silent */
    }
  }

  const sounds = {
    buy: () => tone([523.25, 783.99]),
    win: () => tone([659.25, 987.77, 1318.5], "sine", 0.1),
    loss: () => tone([440, 329.63], "triangle", 0.13),
    nope: () => tone([196], "square", 0.09, 0.06),
    done: () => tone([523.25, 659.25, 783.99, 1046.5], "sine", 0.12),
  };

  function setMuted(on) {
    muted = on;
    store.set("wicklab:mute", on);
    els.mute.classList.toggle("muted", on);
    els.mute.setAttribute("aria-pressed", String(on));
    els.mute.setAttribute("aria-label", on ? "Unmute trade sounds" : "Mute trade sounds");
  }

  /* ---------- animations ---------- */

  function flash(el) {
    sounds.nope();
    if (WL.reducedMotion()) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  }

  function animateTrade(button, label, cls) {
    if (WL.reducedMotion()) return;
    button.classList.remove("pulse");
    void button.offsetWidth;
    button.classList.add("pulse");

    const tag = document.createElement("span");
    tag.className = `float-tag ${cls}`;
    tag.textContent = label;
    els.equityStat.appendChild(tag);
    tag.addEventListener("animationend", () => tag.remove());

    els.dock.classList.remove("hit-up", "hit-down");
    void els.dock.offsetWidth;
    els.dock.classList.add(cls === "up" ? "hit-up" : "hit-down");
  }

  /* ---------- mode ---------- */

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    store.set(MODE_KEY, mode);
    els.modeToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));

    if (mode === "paper") {
      if (state.allCandles.length) begin(state.allCandles);
    } else {
      stop();
      els.dock.classList.add("hidden");
      els.snapshot.classList.remove("hidden");
      if (state.allCandles.length) {
        WL.chart.applySlice(state.allCandles, { animate: true });
        if (WL.snapshot) WL.snapshot.load(state.symbol);
      }
    }
  }

  function setSpeedButtons() {
    els.speed.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.speed) === session.speed));
  }

  /* ---------- events ---------- */

  els.modeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (btn) setMode(btn.dataset.mode);
  });
  els.step.addEventListener("click", () => {
    stop();
    step();
  });
  els.play.addEventListener("click", () => (timer ? stop() : play()));
  els.speed.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-speed]");
    if (!btn || !session) return;
    session.speed = Number(btn.dataset.speed);
    setSpeedButtons();
    if (timer) play();
    save();
  });
  els.buy.addEventListener("click", () => trade("buy"));
  els.sell.addEventListener("click", () => trade("sell"));
  els.max.addEventListener("click", () => {
    if (session) els.qty.value = Math.max(1, Math.floor(session.cash / price()));
  });
  els.reset.addEventListener("click", reset);
  els.mute.addEventListener("click", () => setMuted(!muted));
  els.logToggle.addEventListener("click", () => els.log.classList.toggle("hidden"));

  document.addEventListener("keydown", (e) => {
    if (state.mode !== "paper" || !session) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName);
    if (typing) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      stop();
      step();
    } else if (e.key === " ") {
      e.preventDefault();
      timer ? stop() : play();
    } else if (e.key.toLowerCase() === "b") trade("buy");
    else if (e.key.toLowerCase() === "s") trade("sell");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });

  function init() {
    setMuted(!!store.get("wicklab:mute", false));
    const saved = store.get(MODE_KEY, "live");
    if (saved === "paper") {
      state.mode = "paper";
      els.modeToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === "paper"));
    }
  }

  WL.paper = { begin, step, play, stop, trade, markers, canSwitch, setMode, init, getSession: () => session };
})();
