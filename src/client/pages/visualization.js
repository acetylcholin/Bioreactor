// src/client/pages/visualization.js

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtTime(ms) {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
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
   BASIC + ADVANCED keys
   ========================================================= */

const BASIC_KEYS = [
  "ezortdSensor.value",
  "ezophSensor.value",
  "stirring.rpm",
  "thermostat.percentage",
  "pumps.pumps.acid.sumML",
  "pumps.pumps.base.sumML",
  "pumps.pumps.feed.sumML",
];

const ADVANCED_EXTRA_KEYS = [
  "pumps.pumps.antifoam.sumML",
  "illumination.settings.enabled",
  "illumination.settings.intensity",
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

  if (k.startsWith("illumination.")) {
    return `Light: ${k.split(".").slice(1).join(".")}`;
  }

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

function axisIdForKey(k) {
  return `y_${k.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function cloneScaleCfg(cfg) {
  const out = { ...(cfg || {}) };
  if (cfg?.title) out.title = { ...cfg.title };
  if (cfg?.ticks) out.ticks = { ...cfg.ticks };
  if (cfg?.grid) out.grid = { ...cfg.grid };
  return out;
}

function buildScalesForKeys(keysToPlot) {
  const scales = {
    x: {
      type: "linear",
      title: { display: true, text: "Elapsed time (hours)" },
      ticks: { maxTicksLimit: 12 },
    },
  };

  let axisCount = 0;

  for (const k of keysToPlot) {
    const id = axisIdForKey(k);
    const meta = axisMeta(k);
    const position = axisCount % 2 === 0 ? "left" : "right";
    const drawGrid = axisCount === 0;

    const axis = {
      type: "linear",
      position,
      display: true,
      title: { display: true, text: meta.title || prettyLabel(k) },
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
 * Keep all y-axes in options.scales, but hide unused ones.
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

function buildChart(ctx, datasets, scales) {
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
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: cloneScaleCfg(rawX),
        ...Object.fromEntries(
          Object.entries(rawY).map(([k, v]) => [k, cloneScaleCfg(v)])
        ),
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
        tooltip: {
          enabled: true,
          callbacks: {
            title(items) {
              if (!items || !items.length) return "";
              const x = items[0]?.parsed?.x;
              return Number.isFinite(x) ? `Elapsed: ${x.toFixed(3)} h` : "";
            },
          },
        },
        decimation: {
          enabled: false,
        },
      },
      elements: {
        line: { tension: 0.2 },
        point: { radius: 0 },
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

async function loadSeries(batchId, limit = null) {
  const qs = Number.isFinite(limit) && limit > 0
    ? `?limit=${encodeURIComponent(limit)}`
    : "";
  const data = await getJSON(`/api/batches/${batchId}/sensor${qs}`);
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

    for (const k of Object.keys(flat)) {
      seriesKeysSet.add(k);
    }
  }

  const seriesKeys = Array.from(seriesKeysSet).sort();
  const labels = [];
  const rows = [];

  for (const p of flattened) {
    const h = (p.ts - safeT0) / (1000 * 60 * 60);
    const hour = Number.isFinite(h) ? Number(h.toFixed(6)) : 0;
    labels.push(hour);

    const row = {};
    for (const k of seriesKeys) row[k] = (k in p.flat) ? p.flat[k] : null;
    rows.push(row);
  }

  return { labels, seriesKeys, rows };
}

function chooseKeysToPlot(seriesKeys, showAll) {
  const basicPresent = BASIC_KEYS.filter((k) => seriesKeys.includes(k));

  if (!showAll) {
    return basicPresent.length ? basicPresent : seriesKeys.slice(0, 8);
  }

  const advPresent = ADVANCED_EXTRA_KEYS.filter((k) => seriesKeys.includes(k));
  const merged = [...basicPresent, ...advPresent];

  return merged.length ? merged : seriesKeys;
}

function filterByTimeWindow(labels, rows, mode, customStart, customEnd) {
  if (!Array.isArray(labels) || !Array.isArray(rows) || labels.length !== rows.length) {
    return { labels: [], rows: [] };
  }

  if (!labels.length) {
    return { labels, rows };
  }

  const validHours = labels.filter((v) => Number.isFinite(v));
  if (!validHours.length) {
    return { labels, rows };
  }

  const maxHour = Math.max(...validHours);

  let keepFn;

  switch (mode) {
    case "first12":
      keepFn = (h) => h <= 12;
      break;
    case "first24":
      keepFn = (h) => h <= 24;
      break;
    case "first48":
      keepFn = (h) => h <= 48;
      break;
    case "last12":
      keepFn = (h) => h >= (maxHour - 12);
      break;
    case "last24":
      keepFn = (h) => h >= (maxHour - 24);
      break;
    case "last48":
      keepFn = (h) => h >= (maxHour - 48);
      break;
    case "custom": {
      const start = Number(customStart);
      const end = Number(customEnd);

      if (Number.isFinite(start) && Number.isFinite(end)) {
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        keepFn = (h) => h >= lo && h <= hi;
      } else if (Number.isFinite(start)) {
        keepFn = (h) => h >= start;
      } else if (Number.isFinite(end)) {
        keepFn = (h) => h <= end;
      } else {
        keepFn = () => true;
      }
      break;
    }
    case "all":
    default:
      keepFn = () => true;
      break;
  }

  const outLabels = [];
  const outRows = [];

  for (let i = 0; i < labels.length; i++) {
    const h = labels[i];
    if (Number.isFinite(h) && keepFn(h)) {
      outLabels.push(h);
      outRows.push(rows[i]);
    }
  }

  return { labels: outLabels, rows: outRows };
}

/**
 * Peak-preserving downsampling:
 * for each bucket keep first, min, max, last.
 */
function downsampleMinMax(xValues, yValues, maxPoints = 1200) {
  const pts = [];

  for (let i = 0; i < yValues.length; i++) {
    const y = yValues[i];
    const x = xValues[i];

    if (Number.isFinite(x) && Number.isFinite(y)) {
      pts.push({ x, y, i });
    }
  }

  if (pts.length <= maxPoints) {
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }

  const bucketCount = Math.max(1, Math.floor(maxPoints / 4));
  const bucketSize = Math.ceil(pts.length / bucketCount);
  const reduced = [];

  for (let start = 0; start < pts.length; start += bucketSize) {
    const bucket = pts.slice(start, start + bucketSize);
    if (!bucket.length) continue;

    let minP = bucket[0];
    let maxP = bucket[0];

    for (const p of bucket) {
      if (p.y < minP.y) minP = p;
      if (p.y > maxP.y) maxP = p;
    }

    const firstP = bucket[0];
    const lastP = bucket[bucket.length - 1];

    const keep = [firstP, minP, maxP, lastP]
      .sort((a, b) => a.i - b.i)
      .filter((p, idx, arr) => idx === 0 || p.i !== arr[idx - 1].i);

    reduced.push(...keep);
  }

  return reduced.map((p) => ({ x: p.x, y: p.y }));
}

function buildDatasetsCompressed(keysToPlot, rows, labels, maxPointsPerSeries = 1200) {
  return keysToPlot.map((k) => {
    const yValues = rows.map((r) => {
      const v = r[k];
      return Number.isFinite(v) ? v : NaN;
    });

    const data = downsampleMinMax(labels, yValues, maxPointsPerSeries);

    return {
      label: prettyLabel(k),
      data,
      parsing: false,
      spanGaps: true,
      pointRadius: 0,
      borderWidth: 1.5,
      yAxisID: axisIdForKey(k),
    };
  });
}

function getWindowLabel(mode, customStart, customEnd) {
  switch (mode) {
    case "all":
      return "whole batch";
    case "first12":
      return "first 12 h";
    case "first24":
      return "first 24 h";
    case "first48":
      return "first 48 h";
    case "last12":
      return "last 12 h";
    case "last24":
      return "last 24 h";
    case "last48":
      return "last 48 h";
    case "custom": {
      const hasStart = customStart !== "" && customStart !== null && customStart !== undefined;
      const hasEnd = customEnd !== "" && customEnd !== null && customEnd !== undefined;

      if (hasStart && hasEnd) return `custom ${customStart}–${customEnd} h`;
      if (hasStart) return `custom from ${customStart} h`;
      if (hasEnd) return `custom until ${customEnd} h`;
      return "custom range";
    }
    default:
      return mode || "whole batch";
  }
}

function toggleCustomRangeControls(visible) {
  const wrap = document.getElementById("customRangeWrap");
  if (wrap) {
    wrap.style.display = visible ? "inline-flex" : "none";
  }
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
  const customStartInput = document.getElementById("customStartHour");
  const customEndInput = document.getElementById("customEndHour");

  if (
    !batchSelect ||
    !limitSelect ||
    !btnReload ||
    !btnCsv ||
    !btnFullscreen ||
    !btnToggleSeries ||
    !statusMsg ||
    !canvas ||
    !chartBox
  ) {
    console.error("Visualization page is missing required elements.");
    return;
  }

  const setStatus = (s) => {
    statusMsg.textContent = s || "";
  };

  await loadBatches(batchSelect);

  function getCurrentWindowMode() {
    return limitSelect.value || "all";
  }

  function getCustomRangeValues() {
    return {
      start: customStartInput ? customStartInput.value.trim() : "",
      end: customEndInput ? customEndInput.value.trim() : "",
    };
  }

  btnFullscreen.addEventListener("click", () => {
    chartBox.classList.toggle("fullscreen");
    setTimeout(() => {
      if (chart) chart.resize();
    }, 50);
  });

  btnToggleSeries.addEventListener("click", () => {
    showAllSeries = !showAllSeries;
    btnToggleSeries.textContent = showAllSeries ? "Hide Advanced" : "Show Advanced";
    reload();
  });

  limitSelect.addEventListener("change", () => {
    toggleCustomRangeControls(getCurrentWindowMode() === "custom");
    reload();
  });

  if (customStartInput) {
    customStartInput.addEventListener("change", () => {
      if (getCurrentWindowMode() === "custom") reload();
    });
  }

  if (customEndInput) {
    customEndInput.addEventListener("change", () => {
      if (getCurrentWindowMode() === "custom") reload();
    });
  }

  async function reload() {
    const batchId = batchSelect.value;
    if (!batchId) {
      setStatus("No batches found.");
      return;
    }

    const windowMode = getCurrentWindowMode();
    const { start: customStart, end: customEnd } = getCustomRangeValues();

    // IMPORTANT:
    // This assumes backend returns full batch if no limit is passed.
    const limit = null;

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

      const { labels: allLabels, seriesKeys, rows: allRows } = extractAll(points, t0ms);

      const { labels, rows } = filterByTimeWindow(
        allLabels,
        allRows,
        windowMode,
        customStart,
        customEnd
      );

      if (!labels.length || !rows.length) {
        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        chart = null;
        setStatus(`No data in selected range (${getWindowLabel(windowMode, customStart, customEnd)}).`);
        return;
      }

      const keysToPlot = chooseKeysToPlot(seriesKeys, showAllSeries);
      const datasets = buildDatasetsCompressed(keysToPlot, rows, labels, 1200);
      const scales = buildScalesForKeys(keysToPlot);

      buildChart(canvas.getContext("2d"), datasets, scales);

      const t0Label = (meta && meta.startedAt)
        ? `t0=startedAt (${fmtTime(meta.startedAt)})`
        : `t0=firstPoint (${fmtTime(firstTs)})`;

      const seriesModeLabel = showAllSeries ? "advanced" : "basic";
      const windowLabel = getWindowLabel(windowMode, customStart, customEnd);
      const totalRendered = datasets.reduce((sum, ds) => sum + (ds.data?.length || 0), 0);

      const minH = Math.min(...labels);
      const maxH = Math.max(...labels);

      setStatus(
        `Loaded ${points.length} raw points • window: ${windowLabel} • visible range: ${minH.toFixed(2)}–${maxH.toFixed(2)} h • rendered ${totalRendered} compressed points • ${t0Label} • plotted: ${keysToPlot.length} (${seriesModeLabel})`
      );
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  }

  btnReload.addEventListener("click", reload);
  batchSelect.addEventListener("change", reload);

  btnCsv.addEventListener("click", () => {
    const batchId = batchSelect.value;
    if (!batchId) return;
    window.location.href = `/api/batches/${batchId}/export.csv`;
  });

  toggleCustomRangeControls(getCurrentWindowMode() === "custom");
  await reload();
}

main().catch((e) => console.error(e));