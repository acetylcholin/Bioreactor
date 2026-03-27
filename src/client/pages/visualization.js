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

function arrayMin(arr) {
  let min = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v < min) min = v;
  }
  return min;
}

function arrayMax(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

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

const DEFAULT_MAX_POINTS = 1200;

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

async function loadSeries(batchId, { windowMode, customStart, customEnd, maxPoints }) {
  const params = new URLSearchParams();
  params.set("window", windowMode || "last48");
  params.set("maxPoints", String(maxPoints || DEFAULT_MAX_POINTS));

  if (windowMode === "custom") {
    if (customStart !== "") params.set("fromHour", customStart);
    if (customEnd !== "") params.set("toHour", customEnd);
  }

  return getJSON(`/api/batches/${batchId}/sensor?${params.toString()}`);
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

function buildDatasets(keysToPlot, rows, labels) {
  return keysToPlot.map((k) => ({
    label: prettyLabel(k),
    data: labels.map((x, i) => {
      const v = rows[i]?.[k];
      return Number.isFinite(v) ? { x, y: v } : { x, y: null };
    }),
    parsing: false,
    spanGaps: true,
    pointRadius: 0,
    borderWidth: 1.5,
    yAxisID: axisIdForKey(k),
  }));
}

function getWindowLabel(mode, customStart, customEnd) {
  switch (mode) {
    case "all": return "whole batch";
    case "first12": return "first 12 h";
    case "first24": return "first 24 h";
    case "first48": return "first 48 h";
    case "last12": return "last 12 h";
    case "last24": return "last 24 h";
    case "last48": return "last 48 h";
    case "custom": {
      const hasStart = customStart !== "" && customStart !== null && customStart !== undefined;
      const hasEnd = customEnd !== "" && customEnd !== null && customEnd !== undefined;
      if (hasStart && hasEnd) return `custom ${customStart}–${customEnd} h`;
      if (hasStart) return `custom from ${customStart} h`;
      if (hasEnd) return `custom until ${customEnd} h`;
      return "custom range";
    }
    default:
      return mode || "last 48 h";
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

  // default first load = last 48 h
  if (!limitSelect.value) {
    limitSelect.value = "last48";
  }

  function getCurrentWindowMode() {
    return limitSelect.value || "last48";
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

    setStatus("Loading…");

    try {
      const [meta, sensorResp] = await Promise.all([
        loadBatchMeta(batchId),
        loadSeries(batchId, {
          windowMode,
          customStart,
          customEnd,
          maxPoints: DEFAULT_MAX_POINTS,
        }),
      ]);

      const points = sensorResp.points || [];
      if (!points.length) {
        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        chart = null;
        setStatus(`No data in selected range (${getWindowLabel(windowMode, customStart, customEnd)}).`);
        return;
      }

      const firstTs = points[0].ts;
      const t0ms =
        Number.isFinite(sensorResp.t0ms) ? sensorResp.t0ms
          : (meta && meta.startedAt) ? meta.startedAt
          : firstTs;

      const { labels, seriesKeys, rows } = extractAll(points, t0ms);
      const keysToPlot = chooseKeysToPlot(seriesKeys, showAllSeries);
      const datasets = buildDatasets(keysToPlot, rows, labels);
      const scales = buildScalesForKeys(keysToPlot);

      buildChart(canvas.getContext("2d"), datasets, scales);

      const t0Label =
        Number.isFinite(t0ms)
          ? `t0=${fmtTime(t0ms)}`
          : `t0=firstPoint (${fmtTime(firstTs)})`;

      const seriesModeLabel = showAllSeries ? "advanced" : "basic";
      const windowLabel = getWindowLabel(windowMode, customStart, customEnd);
      const minH = arrayMin(labels);
      const maxH = arrayMax(labels);

      setStatus(
        `Window: ${windowLabel} • visible range: ${minH.toFixed(2)}–${maxH.toFixed(2)} h • raw: ${sensorResp.rawCount || points.length} • sent: ${sensorResp.returnedCount || points.length} • maxPoints: ${sensorResp.maxPoints || DEFAULT_MAX_POINTS} • ${sensorResp.aggregated ? "server-aggregated" : "raw"} • plotted: ${keysToPlot.length} (${seriesModeLabel}) • ${t0Label}`
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