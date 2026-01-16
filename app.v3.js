
/**
 * Stock Events Tracker — app.js
 * - Fetches 1Y daily close prices via Yahoo Finance through a Cloudflare Worker proxy (CORS-safe)
 * - Falls back to adjclose when needed + filters null/NaN (prevents y-axis = 1 issue)
 * - Overlays ±3-day shaded windows for events from events.json
 * - Renders a responsive Chart.js line chart
 */

// =================== CONFIG ===================
const WORKER = 'https://yf-proxy-diego.diego-cote.workers.dev/'; // your Worker URL
const DEFAULT_TICKER = 'AAPL';
const RANGE = '1y';      // '1mo','3mo','6mo','1y','5y','max'
const INTERVAL = '1d';   // '1d','1wk','1mo'

// =================== UTILITIES ===================
console.log('app.js loaded', new Date().toISOString());

/** Format UNIX seconds -> 'YYYY-MM-DD' */
function toYMD(tsSec) {
  const d = new Date(tsSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Keep only pairs with finite numeric values */
function cleanSeries(dates, values) {
  const outDates = [];
  const outVals = [];
  for (let i = 0; i < dates.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      outDates.push(dates[i]);
      outVals.push(v);
    }
  }
  return { dates: outDates, values: outVals };
}

// =================== DATA FETCHING ===================
/**
 * Fetch stock data via Yahoo Chart API through Cloudflare Worker
 * Returns: { dates: ['YYYY-MM-DD',...], close: [Number,...] }
 */
async function getStockData(ticker, range = RANGE, interval = INTERVAL) {
  // Prefer query2 (friendlier). Worker can also rewrite query1->query2.
  const yahoo = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const proxied = `${WORKER}?url=${encodeURIComponent(yahoo)}`;

  const res = await fetch(proxied, { cache: 'no-cache' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Proxy/Yahoo failed: ${res.status} ${text.slice(0, 160)}`);
  }

  const json = await res.json().catch((e) => {
    throw new Error(`Invalid JSON from proxy: ${e.message}`);
  });

  const r = json?.chart?.result?.[0];
  if (!r) {
    const errMsg = json?.chart?.error?.description || 'No chart result';
    throw new Error(errMsg);
  }

  const ts = r.timestamp || [];
  const dates = ts.map(toYMD);

  // Primary series
  let close = r.indicators?.quote?.[0]?.close || [];
  const adj = r.indicators?.adjclose?.[0]?.adjclose || [];

  // If 'close' is missing or mostly nulls, fallback to adjclose
  const closeHasAny = Array.isArray(close) && close.some(v => Number.isFinite(v));
  if (!closeHasAny && Array.isArray(adj) && adj.some(v => Number.isFinite(v))) {
    close = adj;
  }

  // Clean up invalid points so Chart.js gets finite numbers
  const { dates: cleanDates, values: cleanClose } = cleanSeries(dates, close);

  if (!cleanDates.length || cleanDates.length !== cleanClose.length) {
    console.warn('Raw points:', dates.length, 'Clean finite points:', cleanDates.length);
    throw new Error('No valid numeric prices to plot (all values were null/NaN).');
  }

  // Diagnostics
  console.log(
    `Fetched ${cleanDates.length} points for ${ticker}.`,
    'First:', cleanDates[0], cleanClose[0],
    'Last:', cleanDates[cleanDates.length - 1], cleanClose[cleanDates.length - 1]
  );

  return { dates: cleanDates, close: cleanClose };
}

/** Load events.json and filter by ticker (case-insensitive) */
async function getEvents(ticker) {
  const res = await fetch('events.json', { cache: 'no-cache' });
  if (!res.ok) {
