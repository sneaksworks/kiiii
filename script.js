/* wicklab boot
   Wires the search form and starts the app. Loads last: config, indicators,
   api, chart, watchlist must all be loaded before this file. */
(() => {
  const WL = window.WL;
  const form = WL.$("search-form");
  const input = WL.$("ticker-input");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;
    input.value = symbol;
    WL.chart.loadSymbol(symbol, WL.state.tf);
  });

  WL.watchlist.init();
  WL.paper.init();

  const last = WL.watchlist.getLast();
  const symbol = last && last.symbol ? last.symbol : "AAPL";
  const tf = last && WL.INTERVALS[last.tf] ? last.tf : "1D";
  WL.chart.setTimeframe(tf);
  input.value = symbol;
  WL.chart.loadSymbol(symbol, tf);
})();
