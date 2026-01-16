
async function loadEvents(ticker) {
  const res = await fetch("events.json");
  const all = await res.json();
  return all.filter(e => e.ticker === ticker.toUpperCase());
}

function addEventMarkers(chart, events, dates) {
  events.forEach(event => {
    const index = dates.indexOf(event.date);
    if (index !== -1) {
      chart.data.datasets.push({
        type: "scatter",
        label: event.label,
        data: [{ x: event.date, y: chart.data.datasets[0].data[index] }],
        backgroundColor: "red"
      });
    }
  });
}
