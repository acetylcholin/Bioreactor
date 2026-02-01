// src/client/pages/visualization.js

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtTime(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return ""; }
}

function isFiniteNum(x) {
  const n = Number(x);
  return Number.isFinite(n);
}

// Flatten snapshot JSON into { "path.to.value": number }
// Only keeps numeric-ish values.
function flattenNumeric(obj, prefix = "", out = {}) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;

    if (typeof v === "number") {
      if (Number.isFinite(v)) out[key] = v;
      continue;
    }

    // numeric strings
    if (typeof v === "string" && v.trim() !== "" && isFiniteNum(v)) {
      out[key] = Number(v);
      continue;
    }

    if (typeof v === "object" && !Array.isArray(v)) {
      flattenNumeric(v, key, out);
    }
  }
  return out;
}

// ---------- BASIC series shown by default
const BASIC_KEYS = [
  "ezortdSensor.value",
  "ezophSensor.value",
  "stirring.rpm",
  "thermostat.mode",
  "thermostat.percentage",
  "thermostat.power",
  "pumps.pumps.acid.sumMl",
  "pumps.pumps.base.sumMl",
  "pumps.pumps.feed.sumMl",
  "pumps.pumps.antifoam.sumMl",
  "illumination.power",
  "illumination.intensity",
  "illumination.percentage",
  "illumination.value",
];

// ---------- Nice labels
function prettyLabel(k) {
  if (k === "ezortdSensor.value") return "Temperature (°C)";
  if (k === "ezophSensor.value") return "pH";
  if (k === "stirring.rpm") return "Stirring (RPM)";
  if (k === "thermostat.mode") return "Thermostat mode";
  if (k === "thermostat.percentage") return "Thermostat output (%)";
  if (k === "thermostat.power") return "Thermostat power (W)";
  if (k === "pumps.pumps.acid.sumMl") return "Acid total (mL)";
  if (k === "pumps.pumps.base.sumMl") return "Base total (mL)";
  if (k === "pumps.pumps.feed.sumMl") return "Feed total (mL)";
  if (k === "pumps.pumps.antifoam.sumMl") return "Antifoam total (mL)";
  if (k.startsWith("illumination.")) return `Light: ${k.split(".").slice(1).join(".")}`;
  return k;
}

// ---------- Axis meta (suggested ranges)
function axisMeta(k) {
  if (k === "ezortdSensor.value") return { title: "°C" };
  if (k === "ezophSensor.value") return { title: "pH", suggestedMin: 0, suggestedMax: 14 };
  if (k === "stirring.rpm") return { title: "RPM", suggestedMin: 0 };
  if (k === "thermostat.percentage") return { title: "%", suggestedMin: 0, suggestedMax: 100 };
  if (k === "thermostat.power") return { title: "W", suggestedMin: 0 };
  if (k === "thermostat.mode") {
    return {
      title: "mode",
      suggestedMin: -0.5,
      suggestedMax: 2.5,
      stepSize: 1,
      tickCallback: (v) => {
        const n = Number(v);
        if (n === 0) return "Off";
        if (n === 1) return "Heat";
        if (n === 2) return "Cool";
        return String(v);
      },
    };
  }
  if (k.includes("pumps.") && k.endsWith(".sumMl")) return { title: "mL", suggestedMin: 0 };
  if (k.startsWith("illumination.")) return { title: "light", suggestedMin: 0 };
  return { title: "" };
}

// ---------- Scale IDs
function axisIdForKey(k) {
  return `y_${k.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

// Clone scale config (no JSON stringify, keeps callbacks)
function cloneScaleCfg(cfg) {
  const out = { ...(cfg || {}) };
  if (cfg?.title) out.title = { ...cfg.title };
  if (cfg?.ticks) out.ticks = { ...cfg.ticks };
  if (cfg?.grid) out.grid = { ...cfg.grid };
  return out;
}

// ---------- Build scales so EACH key has its own axis
function buildScalesForKeys(keysToPlot) {
  const scales = {
    x: {
      title: { display: true, text: "Elapsed time (hours)" },
      ticks: { maxTicksLimit: 12 },
    },
  };

  // Alternate left/right; only first axis draws grid
  let axisCount = 0;

  for (const k of keysToPlot) {
    const id = axisIdForKey(k);
    const meta = axisMeta(k);

    const position = (axisCount % 2 === 0) ? "left" : "right";
    const drawGrid = (axisCount === 0);

    const axis = {
      type: "linear",
      position,
      display: true,
      title: { display: true, text: meta.title ? meta.title : prettyLabel(k) },
      grid: { drawOnChartArea: drawGrid },
      ticks: { maxTicksLimit: 8 },
    };

    if (Number.isFinite(meta.suggestedMin)) axis.suggestedMin = meta.suggestedMin;
    if (Number.isFinite(meta.suggestedMax)) axis.suggestedMax = meta.suggestedMax;
    if (meta.stepSize) axis.ticks.stepSize = meta.stepSize;
    if (typeof meta.tickCallback === "function") axis.ticks.callback = meta.tickCallback;

    scales[id] = axis;
    axisCount++;
  }

  return scales;
}

let chart = null;
let showAllSeries = false;

/**
 * ✅ Key fix:
 * Keep ALL y-axes in options.scales, but set display/ticks/title off
 * for axes that have no visible datasets.
 * This prevents Chart.js from inventing a default 0–1 y axis.
 */
function updateAxisVisibility(c) {
  const usedAxes = new Set();
  c.data.datasets.forEach((ds, i) => {
    if (c.isDatasetVisible(i)) usedAxes.add(ds.yAxisID);
  });

  // Start from raw scale configs every time (no resolver/proxy objects)
  const newScales = { x: cloneScaleCfg(c._rawXScale) };

  // Apply per-axis visibility
  for (const [id, rawCfg] of Object.entries(c._rawYScales || {})) {
    const cfg = cloneScaleCfg(rawCfg);

    const isUsed = usedAxes.has(id);

    if (!isUsed) {
      // Hide completely
      cfg.display = false;
      cfg.title = { ...(cfg.title || {}), display: false, text: "" };
      cfg.ticks = { ...(cfg.ticks || {}), display: false };
      cfg.grid = { ...(cfg.grid || {}), drawOnChartArea: false };
    } else {
      // Show (restore to raw state)
      cfg.display = true;
      cfg.title = { ...(cfg.title || {}), display: rawCfg?.title?.display ?? true };
      cfg.ticks = { ...(cfg.ticks || {}), display: rawCfg?.ticks?.display ?? true };
      // Keep original grid behavior (only first axis grid typically)
      cfg.grid = { ...(cfg.grid || {}), drawOnChartArea: rawCfg?.grid?.drawOnChartArea ?? false };
    }

    newScales[id] = cfg;
  }

  c.options.scales = newScales;
}

function buildChart(ctx, labels, datasets, inoculationHour, scales) {
  if (chart) chart.destroy();

  const rawX = cloneScaleCfg(scales.x);
  const rawY = {};
  for (const [id, cfg] of Object.entries(scales)) {
    if (id !== "x") rawY[id] = cloneScaleCfg(cfg);
  }

  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: cloneScaleCfg(rawX),
        ...Object.fromEntries(Object.entries(rawY).map(([k, v]) => [k, cloneScaleCfg(v)])),
      },
      plugins: {
        legend: {
          display: true,
          onClick: (e, legendItem, legend) => {
            const c = legend.chart;
            const idx = legendItem.datasetIndex;

            const visible = c.isDatasetVisible(idx);
            c.setDatasetVisibility(idx, !visible);

            updateAxisVisibility(c);
            c.update();
          },
        },
        tooltip: { enabled: true },
      },
    },
    plugins: [
      {
        id: "inoculationLine",
        afterDraw(c) {
          if (inoculationHour === null || inoculationHour === undefined) return;
          const xScale = c.scales.x;
          if (!xScale) return;

          let idx = 0;
          let best = Infinity;
          for (let i = 0; i < c.data.labels.length; i++) {
            const h = Number(c.data.labels[i]);
            const d = Math.abs(h - inoculationHour);
            if (d < best) { best = d; idx = i; }
          }

          const x = xScale.getPixelForValue(c.data.labels[idx]);
          const { top, bottom } = c.chartArea;
          const ctx2 = c.ctx;

          ctx2.save();
          ctx2.beginPath();
          ctx2.setLineDash([6, 6]);
          ctx2.moveTo(x, top);
          ctx2.lineTo(x, bottom);
          ctx2.strokeStyle = "rgba(255,0,0,.85)";
          ctx2.lineWidth = 2;
          ctx2.stroke();

          ctx2.setLineDash([]);
          ctx2.fillStyle = "rgba(255,0,0,.85)";
          ctx2.font = "12px sans-serif";
          ctx2.textAlign = "left";
          ctx2.fillText("Inoc.", x + 6, top + 14);
          ctx2.restore();
        }
      }
    ]
  });

  chart._rawXScale = rawX;
  chart._rawYScales = rawY;

  // Hide axes that aren't used initially (should be none, but safe)
  updateAxisVisibility(chart);
  chart.update();
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

async function loadBatchMeta(batchId) {
  const data = await getJSON(`/api/batches/${batchId}`);
  return data.batch || null;
}

async function loadSeries(batchId, limit) {
  const data = await getJSON(`/api/batches/${batchId}/sensor?limit=${encodeURIComponent(limit)}`);
  return data.points || [];
}

function extractAll(points, t0ms) {
  const seriesKeysSet = new Set();
  const flattened = [];

  for (const p of points) {
    const snap = p.snapshot || {};
    const flat = flattenNumeric(snap);
    flattened.push({ ts: p.ts, flat });
    for (const k of Object.keys(flat)) seriesKeysSet.add(k);
  }

  const seriesKeys = Array.from(seriesKeysSet).sort();
  const labels = [];
  const rows = [];

  for (const p of flattened) {
    const h = (p.ts - t0ms) / (1000 * 60 * 60);
    const hour = Number.isFinite(h) ? Number(h.toFixed(3)) : null;
    labels.push(hour);

    const row = {};
    for (const k of seriesKeys) row[k] = (k in p.flat) ? p.flat[k] : null;
    rows.push(row);
  }

  return { labels, seriesKeys, rows };
}

function chooseKeysToPlot(seriesKeys, showAll) {
  if (showAll) return seriesKeys;
  const presentBasic = seriesKeys.filter(k => BASIC_KEYS.includes(k));
  if (presentBasic.length > 0) return presentBasic;
  return seriesKeys.slice(0, 8);
}

function buildDatasets(keysToPlot, rows) {
  return keysToPlot.map((k) => ({
    label: prettyLabel(k),
    data: rows.map(r => r[k]),
    tension: 0.25,
    pointRadius: 0,
    yAxisID: axisIdForKey(k),
    stepped: (k === "thermostat.mode"),
  }));
}

async function main() {
  const batchSelect = document.getElementById("batchSelect");
  const limitSelect = document.getElementById("limitSelect");
  const btnReload = document.getElementById("btnReload");
  const btnCsv = document.getElementById("btnCsv");
  const btnFullscreen = document.getElementById("btnFullscreen");
  const btnToggleSeries = document.getElementById("btnToggleSeries");
  const statusMsg = document.getElementById("statusMsg");
  const canvas = document.getElementById("chart");
  const chartBox = document.getElementById("chartBox");

  const setStatus = (s) => (statusMsg.textContent = s || "");

  await loadBatches(batchSelect);

  btnFullscreen.addEventListener("click", () => {
    chartBox.classList.toggle("fullscreen");
    setTimeout(() => { if (chart) chart.resize(); }, 50);
  });

  btnToggleSeries.addEventListener("click", () => {
    showAllSeries = !showAllSeries;
    btnToggleSeries.textContent = showAllSeries ? "Hide Advanced" : "Show Advanced";
    reload();
  });

  async function reload() {
    const batchId = batchSelect.value;
    if (!batchId) {
      setStatus("No batches found.");
      return;
    }

    const limit = Number(limitSelect.value) || 600;

    setStatus("Loading…");
    try {
      const [meta, points] = await Promise.all([
        loadBatchMeta(batchId),
        loadSeries(batchId, limit),
      ]);

      if (!points.length) {
        if (chart) chart.destroy();
        setStatus("No sensor points yet for this batch.");
        return;
      }

      const firstTs = points[0].ts;
      const t0ms = (meta && meta.inoculatedAt) ? meta.inoculatedAt
        : (meta && meta.startedAt) ? meta.startedAt
        : firstTs;

      const inocHour = (meta && meta.inoculatedAt) ? 0 : null;

      const { labels, seriesKeys, rows } = extractAll(points, t0ms);

      const keysToPlot = chooseKeysToPlot(seriesKeys, showAllSeries);
      const datasets = buildDatasets(keysToPlot, rows);
      const scales = buildScalesForKeys(keysToPlot);

      buildChart(canvas.getContext("2d"), labels, datasets, inocHour, scales);

      const t0Label =
        (meta && meta.inoculatedAt) ? `t0=inoculatedAt (${fmtTime(meta.inoculatedAt)})`
          : (meta && meta.startedAt) ? `t0=startedAt (${fmtTime(meta.startedAt)})`
            : `t0=firstPoint (${fmtTime(firstTs)})`;

      const modeLabel = showAllSeries ? "advanced" : "basic";
      setStatus(`Loaded ${points.length} points • ${t0Label} • plotted: ${keysToPlot.length} (${modeLabel})`);
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

  await reload();
}

main().catch((e) => console.error(e));
