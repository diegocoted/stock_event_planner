
const WORKER = 'https://yf-proxy-diego.diego-cote.workers.dev/'; // your Worker URL
const DEFAULT_TICKER = 'AAPL';
const RANGE = '1y';
const INTERVAL = '1d';

console.log('app.js loaded', new Date().toISOString());

function toYMD(tsSec) {
  const d = new Date(tsSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
        backgroundColor: 'rgba(255,255,255,0.0)'
      }
    };
  }
  return anns;
}

let chart;
function renderChart(dates, close, annotations) {
  const canvas = document.getElementById('chart');
  if (!canvas) return console.error('Canvas #chart not found');
  const ctx = canvas.getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'Close',
        data: close,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.10)',
        fill: true,
        pointRadius: 0,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: { type: 'time', time: { unit: 'day', tooltipFormat: 'yyyy-MM-dd' }, ticks: { autoSkip: true, maxTicksLimit: 10 } },
        y: { beginAtZero: false, ticks: { callback: (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : v) } }
      },
      plugins: { legend: { display: true }, tooltip: { mode: 'index', intersect: false }, annotation: { annotations } },
      interaction: { mode: 'index', intersect: false }
    }
  });
}

async function loadChart(ticker, range = RANGE, interval = INTERVAL) {
  const btn = document.getElementById('loadBtn');
  try {
    if (btn) btn.disabled = true;
    const [{ dates, close }, events] = await Promise.all([ getStockData(ticker, range, interval), getEvents(ticker) ]);
    const annotations = buildWindowAnnotations(dates, events);
    renderChart(dates, close, annotations);
  } catch (err) {
    console.error(err);
    alert(`Error loading ${ticker}: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireUI() {
  const input = document.getElementById('ticker');
  const btn = document.getElementById('loadBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const t = (input?.value || '').trim().toUpperCase();
      if (!t) return alert('Enter a ticker (e.g., AAPL)');
      loadChart(t);
    });
  }
  if (input) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn?.click(); });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('Chart.js present? ', typeof Chart);
  const tInput = document.getElementById('ticker');
  if (tInput) tInput.value = DEFAULT_TICKER;
  wireUI();
  loadChart(DEFAULT_TICKER);
});
``
