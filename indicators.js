/*
  wicklabs indicators
  Pure math, no DOM. Every function only looks backward in time,
  so nothing here repaints once a bar has closed.
*/
const Indicators = (() => {
  const empty = (n) => new Array(n).fill(null);

  function sma(values, period) {
    const out = empty(values.length);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = empty(values.length);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      if (prev === null) {
        if (i >= period - 1) {
          let s = 0;
          for (let j = 0; j < period; j++) s += values[i - j];
          prev = s / period;
          out[i] = prev;
        }
        continue;
      }
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function stdev(values, period) {
    const out = empty(values.length);
    for (let i = period - 1; i < values.length; i++) {
      let mean = 0;
      for (let j = 0; j < period; j++) mean += values[i - j];
      mean /= period;
      let v = 0;
      for (let j = 0; j < period; j++) v += (values[i - j] - mean) ** 2;
      out[i] = Math.sqrt(v / period);
    }
    return out;
  }

  // Wilder's average true range
  function atr(candles, period) {
    const n = candles.length;
    const tr = empty(n);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (i === 0) {
        tr[i] = c.high - c.low;
        continue;
      }
      const pc = candles[i - 1].close;
      tr[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    }
    const out = empty(n);
    let prev = null;
    for (let i = 0; i < n; i++) {
      if (prev === null) {
        if (i === period - 1) {
          let s = 0;
          for (let j = 0; j < period; j++) s += tr[i - j];
          prev = s / period;
          out[i] = prev;
        }
        continue;
      }
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
    return out;
  }

  // Classic SuperTrend: an ATR based trailing line that flips when price crosses it
  function superTrend(candles, period = 10, mult = 3) {
    const n = candles.length;
    const a = atr(candles, period);
    const line = empty(n);
    const trend = empty(n);
    const flips = [];
    let fu = null;
    let fl = null;
    let t = null;

    for (let i = 0; i < n; i++) {
      if (a[i] === null) continue;
      const c = candles[i];
      const hl2 = (c.high + c.low) / 2;
      const bu = hl2 + mult * a[i];
      const bl = hl2 - mult * a[i];
      const pc = i > 0 ? candles[i - 1].close : c.close;

      const nfu = fu === null || bu < fu || pc > fu ? bu : fu;
      const nfl = fl === null || bl > fl || pc < fl ? bl : fl;

      let nt;
      if (t === null) nt = c.close > hl2 ? 1 : -1;
      else if (t === 1) nt = c.close < nfl ? -1 : 1;
      else nt = c.close > nfu ? 1 : -1;

      if (t !== null && nt !== t) flips.push({ index: i, dir: nt });

      fu = nfu;
      fl = nfl;
      t = nt;
      trend[i] = t;
      line[i] = t === 1 ? fl : fu;
    }
    return { line, trend, flips, atr: a };
  }

  function bollinger(closes, period = 20, mult = 2) {
    const mid = sma(closes, period);
    const sd = stdev(closes, period);
    const upper = mid.map((m, i) => (m === null ? null : m + mult * sd[i]));
    const lower = mid.map((m, i) => (m === null ? null : m - mult * sd[i]));
    return { upper, mid, lower };
  }

  // Least squares fit, x is just the bar index
  function regression(values) {
    const n = values.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      sx += i;
      sy += values[i];
      sxy += i * values[i];
      sxx += i * i;
    }
    const denom = n * sxx - sx * sx;
    const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    return { slope, intercept };
  }

  // Rolling regression endpoint, the same thing TradingView calls LSMA
  function lsma(closes, window = 20) {
    const out = empty(closes.length);
    for (let i = window - 1; i < closes.length; i++) {
      const seg = closes.slice(i - window + 1, i + 1);
      const { slope, intercept } = regression(seg);
      out[i] = slope * (window - 1) + intercept;
    }
    return out;
  }

  // Forward projection with a widening uncertainty cone
  function projection(closes, { lookback = 30, forward = 12 } = {}) {
    const seg = closes.slice(-lookback);
    const { slope, intercept } = regression(seg);
    let s = 0;
    for (let i = 1; i < seg.length; i++) s += (seg[i] - seg[i - 1]) ** 2;
    const sigma = Math.sqrt(s / Math.max(1, seg.length - 1));
    const last = closes[closes.length - 1];
    const fitted = slope * (seg.length - 1) + intercept;
    const offset = last - fitted;
    const center = [];
    const width = [];
    for (let t = 1; t <= forward; t++) {
      center.push(slope * (seg.length - 1 + t) + intercept + offset);
      width.push(sigma * Math.sqrt(t));
    }
    return { center, width, slope, sigma };
  }

  /*
    k-nearest neighbors classifier.
    Features for bar i: the last `window` percent returns, distance from the
    20 bar average, and the candle's range. Neighbors are only drawn from
    bars whose outcome was already known at bar i (j <= i - horizon), so the
    model never peeks at the future. Output is the weighted share of
    neighbors whose price rose over the next `horizon` bars.
  */
  function knnProbabilities(candles, { window = 5, horizon = 3, k = 20, warmup = 20 } = {}) {
    const n = candles.length;
    const closes = candles.map((c) => c.close);
    const rets = closes.map((c, i) => (i === 0 ? 0 : c / closes[i - 1] - 1));
    const base = sma(closes, warmup);

    const feats = empty(n);
    for (let i = Math.max(window, warmup); i < n; i++) {
      const f = [];
      for (let j = 0; j < window; j++) f.push(rets[i - j] * 100);
      f.push(((closes[i] - base[i]) / base[i]) * 100);
      f.push(((candles[i].high - candles[i].low) / closes[i]) * 100);
      feats[i] = f;
    }

    const labels = empty(n);
    for (let i = 0; i + horizon < n; i++) labels[i] = closes[i + horizon] > closes[i] ? 1 : 0;

    const probs = empty(n);
    for (let i = 0; i < n; i++) {
      if (!feats[i]) continue;
      const pool = [];
      for (let j = 0; j <= i - horizon; j++) {
        if (!feats[j] || labels[j] === null) continue;
        let d = 0;
        for (let m = 0; m < feats[i].length; m++) d += (feats[i][m] - feats[j][m]) ** 2;
        pool.push([Math.sqrt(d), labels[j]]);
      }
      if (pool.length < k) continue;
      pool.sort((x, y) => x[0] - y[0]);
      let w = 0, s = 0;
      for (let m = 0; m < k; m++) {
        const wt = 1 / (pool[m][0] + 0.05);
        w += wt;
        s += wt * pool[m][1];
      }
      probs[i] = s / w;
    }
    return probs;
  }

  // Volume spikes that also break the recent high or low
  function volumeBreakouts(candles, { volPeriod = 20, mult = 1.8, range = 10 } = {}) {
    const vols = candles.map((c) => c.volume || 0);
    const volSma = sma(vols, volPeriod);
    const spikes = new Set();
    const events = [];
    for (let i = range; i < candles.length; i++) {
      if (volSma[i] === null || vols[i] <= volSma[i] * mult) continue;
      spikes.add(i);
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = 1; j <= range; j++) {
        hh = Math.max(hh, candles[i - j].high);
        ll = Math.min(ll, candles[i - j].low);
      }
      if (candles[i].close > hh) events.push({ index: i, dir: 1 });
      else if (candles[i].close < ll) events.push({ index: i, dir: -1 });
    }
    return { volSma, spikes, events };
  }

  return { sma, ema, stdev, atr, superTrend, bollinger, regression, lsma, projection, knnProbabilities, volumeBreakouts };
})();

if (typeof window !== "undefined") window.Indicators = Indicators;
if (typeof module !== "undefined") module.exports = Indicators;
