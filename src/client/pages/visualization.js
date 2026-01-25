async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtTime(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return ""; }
}

let chart = null;

function buildChart(ctx, labels, tempC, ph) {
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Temperature (°C)",
          data: tempC,
          yAxisID: "yTemp",
          tension: 0.25,
          pointRadius: 0,
        },
        {
          label: "pH",
          data: ph,
          yAxisID: "yPh",
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
        yTemp: { type: "linear", position: "left" },
        yPh: { type: "linear", position: "right", grid: { drawOnChartArea: false } },
      },
      plugins: {
        legend: { display: true },
        tooltip: { enabled: true },
      },
    },
  });
}

async function loadBatches(selectEl) {
  const data = await getJSON("/api/batches/list");
  const batches = data.batches || [];

  selectEl.innerHTML = "";
  for (const b of batches) {
    const opt = document.createElement("option");
    opt.value = String(b.id);
    opt.textContent = `${b.batchNumber} • ${b.status} • started: ${b.startedAt ? fmtTime(b.startedAt) : "—"}`;
    selectEl.appendChild(opt);
  }

  return batches;
}

async function loadSeries(batchId, limit) {
  // returns points: [{ts, snapshot}]
  const data = await getJSON(`/api/batches/${batchId}/sensor?limit=${encodeURIComponent(limit)}`);
  return data.points || [];
}

function extract(points) {
  const labels = [];
  const tempC = [];
  const ph = [];

  for (const p of points) {
    const ts = p.ts;
    const snap = p.snapshot || {};

    const t = snap?.ezortdSensor?.value ?? null;
    const h = snap?.ezophSensor?.value ?? null;

    labels.push(new Date(ts).toLocaleTimeString());
    tempC.push(t !== null ? Number(t) : null);
    ph.push(h !== null ? Number(h) : null);
  }

  return { labels, tempC, ph };
}

async function main() {
  const batchSelect = document.getElementById("batchSelect");
  const limitSelect = document.getElementById("limitSelect");
  const btnReload = document.getElementById("btnReload");
  const btnCsv = document.getElementById("btnCsv");
  const statusMsg = document.getElementById("statusMsg");
  const canvas = document.getElementById("chart");

  const setStatus = (s) => (statusMsg.textContent = s || "");

  await loadBatches(batchSelect);

  async function reload() {
    const batchId = batchSelect.value;
    if (!batchId) {
      setStatus("No batches found.");
      return;
    }

    const limit = Number(limitSelect.value) || 600;

    setStatus("Loading…");
    try {
      const points = await loadSeries(batchId, limit);
      const { labels, tempC, ph } = extract(points);

      buildChart(canvas.getContext("2d"), labels, tempC, ph);
      setStatus(`Loaded ${points.length} points`);
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  }

  btnReload.addEventListener("click", reload);
  batchSelect.addEventListener("change", reload);
  limitSelect.addEventListener("change", reload);

  btnCsv.addEventListener("click", () => {
    const batchId = batchSelect.value;
    if (!batchId) return;
    window.location.href = `/api/batches/${batchId}/export.csv`;
  });

  // initial
  await reload();
}

main().catch((e) => console.error(e));
