/*
  wicklab news proxy (Cloudflare Worker)

  ONLY needed if the site shows the CORS message on the News tab.
  This forwards one specific request to Finnhub, keeps your Finnhub key
  on Cloudflare's side instead of in the page, and refuses everything else.

  Setup, about five minutes:
  1. Create a free account at cloudflare.com, open Workers & Pages, click Create,
     choose Worker, give it a name like wicklab-news, click Deploy.
  2. Click Edit code, delete the starter code, paste this whole file, click Deploy.
  3. In the worker's Settings, go to Variables and Secrets, add a secret named
     FINNHUB_KEY with your Finnhub key as the value, and save.
  4. Copy the worker URL (looks like https://wicklab-news.yourname.workers.dev)
     and paste it into NEWS_PROXY in config.js. Leave FINNHUB_KEY in config.js
     empty when using the proxy so the key is not exposed in the page.
*/

const ALLOWED_ORIGINS = [
  "https://sneaksworks.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });

    const url = new URL(request.url);
    const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";

    const okSymbol = /^[A-Z0-9.\-]{1,12}$/.test(symbol);
    const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!okSymbol || !okDate(from) || !okDate(to)) {
      return new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!env.FINNHUB_KEY) {
      return new Response(JSON.stringify({ error: "FINNHUB_KEY secret not set on the worker" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const upstream =
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}` +
      `&from=${from}&to=${to}&token=${encodeURIComponent(env.FINNHUB_KEY)}`;

    const res = await fetch(upstream, { cf: { cacheTtl: 300, cacheEverything: true } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  },
};
