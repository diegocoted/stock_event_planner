
console.log("app.js loaded", new Date().toISOString());
console.log("Chart.js present? ", typeof Chart);

// app.js — minimal MVP

let chart; // hold the Chart.js instance

// Attach UI
document.getElementById('loadBtn')?.addEventListener('click', () => {
  const t = document.getElementById('ticker').value.trim().toUpperCase();
  if (!t) return alert('Enter a ticker (e.g., AAPL)');
  loadChart(t);
});

// Helper: format a UNIX timestamp (seconds) to YYYY-MM-DD
function toYMD(tsSec) {
  const d = new Date(tsSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Fetch OHLC data from Yahoo Finance chart API
async function getStockData(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo fetch failed: ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error('No chart result');
  const ts = r.timestamp || [];
  const close = r.indicators?.quote?.[0]?.close || [];
  const dates = ts.map(toYMD);
  return { dates, close };
}

// Load events.json and filter by ticker
async function getEvents(ticker) {
  const res = await fetch('events.json', { cache: 'no-cache' });
  if (!res.ok) return [];
  const all = await res.json();
  return all.filter(e => (e.ticker || '').toUpperCase() === ticker.toUpperCase());
}

// Build annotation boxes for ±3 days around each event date
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

    const id = `ev_${ev.ticker}_${ev.date}_${Math.random().toString(36).slice(2,7)}`;
    anns[id] = {
      type: 'box',
      xMin,
      xMax,
      backgroundColor: 'rgba(255, 206, 86, 0.15)', // soft amber
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

// Create or update the Chart.js line chart
function renderChart(dates, close, annotations) {
  const ctx = document.getElementById('chart').getContext('2d');

  // destroy previous chart if any
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'Close',
        data: close,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.08)',
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
        x: {
          type: 'time',
          time: { unit: 'day', tooltipFormat: 'yyyy-MM-dd' },
          ticks: { autoSkip: true, maxTicksLimit: 10 }
        },
        y: {
          beginAtZero: false,
          ticks: { callback: (v) => v.toFixed ? v.toFixed(2) : v }
        }
      },
      plugins: {
        legend: { display: true },
        tooltip: { mode: 'index', intersect: false },
        annotation: {
          annotations
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
}

// Orchestrator
async function loadChart(ticker) {
  try {
    document.getElementById('loadBtn').disabled = true;

    const [{ dates, close }, events] = await Promise.all([
      getStockData(ticker),
      getEvents(ticker)
    ]);

    const annotations = buildWindowAnnotations(dates, events);
    renderChart(dates, close, annotations);
  } catch (err) {
    console.error(err);
    alert(`Error: ${err.message}`);
  } finally {
    document.getElementById('loadBtn').disabled = false;
  }
}

// Optional: load a default ticker on first visit
window.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('ticker');
  if (el) el.value = 'AAPL';
  loadChart('AAPL');
});
