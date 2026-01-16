
/**
 * Stock Events Tracker — app.js
 * - Fetches 1Y daily close prices via Yahoo Finance through a Cloudflare Worker proxy
 * - Overlays ±3 day shaded windows for events from events.json
 * - Renders a responsive Chart.js line chart
 *
 * Requirements in index.html (self-hosted preferred):
 *   <script src="vendor/chart.umd.min.js"></script>
 *   <script src="vendor/chartjs-adapter-date-fns.bundle.min.js"></script>
 *   <script src="vendor/chartjs-plugin-annotation.min.js"></script>
 *   <script src="app.js"></script>
 *
 * Make sure chart.css gives the canvas a height (aspect-ratio or fixed height).
 */

// =================== CONFIG ===================
const WORKER = 'https://yf-proxy-diego.diego-cote.workers.dev/'; 
const DEFAULT_TICKER = 'AAPL';
const RANGE = '1y';         // '1mo','3mo','6mo','1y','5y','max'
const INTERVAL = '1d';      // '1d','1wk','1mo'

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

/** Debounce helper (for future UX upgrades) */
function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// =================== DATA FETCHING ===================
/**
 * Fetch stock data via Yahoo Chart API through Cloudflare Worker
 * Returns: { dates: ['YYYY-MM-DD',...], close: [Number,...] }
 */
async function getStockData(ticker, range = RANGE, interval = INTERVAL) {
  const yahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const url = `${WORKER}?url=${encodeURIComponent(yahoo)}`;

  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Proxy/Yahoo failed: ${res.status} ${text.slice(0, 120)}`);
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

  // Basic sanity checks
  if (!dates.length || dates.length !== close.length) {
    throw new Error('Malformed data: dates/close length mismatch');
  }

  return { dates, close };
}

/** Load events.json and filter by ticker (case-insensitive) */
async function getEvents(ticker) {
  const res = await fetch('events.json', { cache: 'no-cache' });
  if (!res.ok) {
    console.warn('events.json not found or invalid. Proceeding without events.');
    return [];
  }
  const all = await res.json().catch((e) => {
    console.warn('events.json parse error:', e.message);
    return [];
  });
  return (all || []).filter(e => (e.ticker || '').toUpperCase() === ticker.toUpperCase());
}

// =================== ANNOTATIONS (±3 DAY WINDOWS) ===================
/**
 * Build Chart.js Annotation plugin boxes for ±3 trading days around event date.
 * Dates must match labels array values 'YYYY-MM-DD'.
 */
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
      backgroundColor: 'rgba(255, 206, 86, 0.15)', // amber
      borderWidth: 0,
      label: {
        display: true,
        content: ev.label || 'Event',
        position: 'start',
        color: '#6b7280',
        backgroundColor: 'rgba(255,255,255,0.0)'
      }
    };
  }

  return anns;
}

// =================== CHART RENDERING ===================
let chart; // Chart.js instance

function renderChart(dates, close, annotations) {
  const canvas = document.getElementById('chart');
  if (!canvas) {
    console.error('Canvas #chart not found');
    return;
  }

  const ctx = canvas.getContext('2d');
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'Close',
        data: close,
