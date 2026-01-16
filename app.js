
/**
 * Stock Events Tracker — app.js
 * Uses Cloudflare Worker proxy to fetch Yahoo Finance data (CORS-safe)
 * Overlays ±3-day shaded windows for events from events.json
 * Renders responsive Chart.js line chart
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

// =================== DATA FETCHING ===================
/** Fetch stock data via Yahoo Chart API through Cloudflare Worker */
async function getStockData(ticker, range = RANGE, interval = INTERVAL) {
  const yahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
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
  const close = r.indicators?.quote?.[0]?.close || [];
  const dates = ts.map(toYMD);

  if (!dates.length || dates.length !== close.length) {
    throw new Error('Malformed data: dates/close length mismatch');
  }

  return { dates, close };
}

/** Load events.json and filter by ticker (case-insensitive) */
async function getEvents(ticker) {
  const res = await fetch('events.json', { cache: 'no-cache' });
  if (!res.ok) {
    console.warn('events.json missing or not public. Proceeding without events.');
    return [];
  }
  const all = await res.json().catch((e) => {
    console.warn('events.json parse error:', e.message);
    return [];
  });
  return (all || []).filter(e => (e.ticker || '').toUpperCase() === ticker.toUpperCase());
}

// =================== ANNOTATIONS (±3 DAY WINDOWS) ===================
/** Build Chart.js Annotation plugin boxes for ±3 trading days around event date */
function buildWindowAnnotations(dates, events) {
  const anns = {};
  const toIndex = Object.fromEntries(dates.map((d, i) => [d, i]));

  for (const ev of events) {
    const idx = toIndex[ev.date];
    if (idx === undefined) continue;

    const startIdx = Math.max(0, idx - 3);
    const endIdx = Math.min(dates.length - 1, idx + 3);
    const xMin = dates[startIdx];
    const xMax = dates[endIdx];

    const id = `ev_${(ev.ticker || '').toUpperCase()}_${ev.date}_${Math.random().toString(36).slice(2, 7)}`;
    anns[id] = {
      type: 'box',
      xMin,
      xMax,
      backgroundColor: 'rgba(255, 206, 86, 0.15)',
      borderWidth: 0,
      label: {
        display: true,
        content: ev.label || 'Event',
        position: 'start',
        color: '#6b7280',
