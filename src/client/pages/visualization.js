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

/* =========================================================
   BASIC + ADVANCED keys (what you asked)
   ========================================================= */

// BASIC = only these series
const BASIC_KEYS = [
  "ezortdSensor.value",          // Temperature
  "ezophSensor.value",           // pH
  "stirring.rpm",                // Stirring
  "thermostat.percentage",       // Thermostat %
  "pumps.pumps.acid.sumML",      // Acid total (mL)
  "pumps.pumps.base.sumML",      // Base total (mL)
  "pumps.pumps.feed.sumML",      // Feed total (mL)
];

// ADVANCED = Basic + these
const ADVANCED_EXTRA_KEYS = [
  "pumps.pumps.antifoam.sumML",  // Antifoam total (mL)

  // illumination numeric fields (only plotted if present and numeric)
  "illumination.settings.enabled",    // could be 0/1
  "illumination.settings.intensity",  // numeric
  "illumination.intensity",
  "illumination.percentage",
  "illumination.power",
  "illumination.value",
];

function prettyLabel(k) {
  if (k === "ezortdSensor.value") return "Temperature (°C)";
  if (k === "ezophSensor.value") return "pH";
  if (k === "stirring.rpm") return "Stirring (RPM)";
  if (k === "thermostat.percentage") return "Thermostat output (%)";

  if (k === "pumps.pumps.acid.sumML") return "Acid total (mL)";
  if (k === "pumps.pumps.base.sumML") return "Base total (mL)";
  if (k === "pumps.pumps.feed.sumML") return "Feed total (mL)";
  if (k === "pumps.pumps.antifoam.sumML") return "Antifoam total (mL)";

  if (k.startsWith("illumination.")) return `Light: ${k.split(".").slice(1).join(".")}`;

  return k;
}

function axisMeta(k) {
  if (k === "ezortdSensor.value") return { title: "°C" };
  if (k === "ezophSensor.value") return { title: "pH", suggestedMin: 0, suggestedMax: 14 };
  if (k === "stirring.rpm") return { title: "RPM", suggestedMin: 0 };
  if (k === "thermostat.percentage") return { title: "%", suggestedMin: 0, suggestedMax: 100 };
  if (k.includes("pumps.") && k.endsWith(".sumML")) return { title: "mL", suggestedMin: 0 };
  if (k.startsWith("illumination.")) return { title: "light", suggestedMin: 0 };
  return { title: "" };
}

// Scale IDs (Chart.js requires unique IDs)
function axisIdForKey(k) {
  return `y_${k.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

// Clone scale config (keeps callbacks if ever added later)
function cloneScaleCfg(cfg) {
  const out = { ...(cfg || {}) };
  if (cfg?.title) out.title = { ...cfg.title };
  if (cfg?.ticks) out.ticks = { ...cfg.ticks };
  if (cfg?.grid) out.grid = { ...cfg.grid };
  return out;
}

// Build scales so EACH key has its own y-axis.
// Alternate left/right; only first axis draws grid.
function buildScalesForKeys(keysToPlot) {
  const scales = {
    x: {
      title: { display: true, text: "Elapsed time (hours)" },
      ticks: { maxTicksLimit: 12 },
    },
  };

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

    scales[id] = axis;
    axisCount++;
  }

  return scales;
}

let chart = null;
let showAllSeries = false;

/**
 * Keep ALL y-axes in options.scales, but set display OFF for axes
 * that have no visible datasets. This prevents Chart.js from inventing
 * a default 0–1 axis.
 */
function updateAxisVisibility(c) {
  const usedAxes = new Set();
  c.data.datasets.forEach((ds, i) => {
    if (c.isDatasetVisible(i)) usedAxes.add(ds.yAxisID);
  });

  const newScales = { x: cloneScaleCfg(c._rawXScale) };

  for (const [id, rawCfg] of Object.entries(c._rawYScales || {})) {
    const cfg = cloneScaleCfg(rawCfg);
    const isUsed = usedAxes.has(id);

    if (!isUsed) {
      cfg.display = false;
      cfg.title = { ...(cfg.title || {}), display: false, text: "" };
      cfg.ticks = { ...(cfg.ticks || {}), display: false };
      cfg.grid = { ...(cfg.grid || {}), drawOnChartArea: false };
    } else {
      cfg.display = true;
      cfg.title = { ...(cfg.title || {}), display: rawCfg?.title?.display ?? true };
      cfg.ticks = { ...(cfg.ticks || {}), display: rawCfg?.ticks?.display ?? true };
      cfg.grid = { ...(cfg.grid || {}), drawOnChartArea: rawCfg?.grid?.drawOnChartArea ?? false };
    }

    newScales[id] = cfg;
  }

  c.options.scales = newScales;
}

function buildChart(ctx, labels, datasets, inoculationHour, scales) {
  // destroy any chart bound to this canvas (prevents "canvas already in use")
  const existing = Chart.getChart(ctx.canvas);
  if (existing) existing.destroy();
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
  });

  chart._rawXScale = rawX;
  chart._rawYScales = rawY;

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
  const base = Number(t0ms);
  const safeT0 = Number.isFinite(base) ? base : (points[0]?.ts ?? Date.now());

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
    const h = (p.ts - safeT0) / (1000 * 60 * 60);
    const hour = Number.isFinite(h) ? Number(h.toFixed(3)) : 0;
    labels.push(hour);

    const row = {};
    for (const k of seriesKeys) row[k] = (k in p.flat) ? p.flat[k] : null;
    rows.push(row);
  }

  return { labels, seriesKeys, rows };
}

function chooseKeysToPlot(seriesKeys, showAll) {
  const basicPresent = BASIC_KEYS.filter(k => seriesKeys.includes(k));

  if (!showAll) {
    return basicPresent.length ? basicPresent : seriesKeys.slice(0, 8);
  }

  const advPresent = ADVANCED_EXTRA_KEYS.filter(k => seriesKeys.includes(k));
  const merged = [...basicPresent, ...advPresent];

  return merged.length ? merged : seriesKeys;
}

function buildDatasets(keysToPlot, rows) {
  return keysToPlot.map((k) => ({
    label: prettyLabel(k),
    data: rows.map(r => r[k]),
    tension: 0.25,
    pointRadius: 0,
    yAxisID: axisIdForKey(k),
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

  if (!batchSelect || !limitSelect || !btnReload || !btnCsv || !btnFullscreen || !btnToggleSeries || !statusMsg || !canvas || !chartBox) {
    console.error("Visualization page is missing required elements.");
    return;
  }

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
        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        chart = null;
        setStatus("No sensor points yet for this batch.");
        return;
      }

      const firstTs = points[0].ts;
      const t0ms = (meta && meta.startedAt) ? meta.startedAt : firstTs;

      const { labels, seriesKeys, rows } = extractAll(points, t0ms);

      const keysToPlot = chooseKeysToPlot(seriesKeys, showAllSeries);
      const datasets = buildDatasets(keysToPlot, rows);
      const scales = buildScalesForKeys(keysToPlot);

      buildChart(canvas.getContext("2d"), labels, datasets, null, scales);

      const t0Label =
        (meta && meta.startedAt) ? `t0=startedAt (${fmtTime(meta.startedAt)})`
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