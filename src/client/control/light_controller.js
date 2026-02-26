// src/client/control/light_controller.js
// Client-side light scheduler: ramps intensity + interpolates color over time.
// Sends only { enabled, color, intensity } to /api/illumination/settings.
//
// Storage: localStorage key "lightScheduleV1"

const LS_KEY = "lightScheduleV1";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function clampInt(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function parseHHMM(hhmm) {
  // "05:00" -> minutes since midnight
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesNowLocal() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function hexToRgb(hex) {
  const h = (hex || "").trim();
  const m = h.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return { r: 0, g: 0, b: 0 };
  const s = m[1];
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex({ r, g, b }) {
  const rr = pad2(clampInt(Math.round(r), 0, 255).toString(16));
  const gg = pad2(clampInt(Math.round(g), 0, 255).toString(16));
  const bb = pad2(clampInt(Math.round(b), 0, 255).toString(16));
  return `#${rr}${gg}${bb}`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  });
}

async function postIlluminationSettings(settings) {
  const resp = await fetch("/api/illumination/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`POST /api/illumination/settings failed: ${resp.status} ${txt}`);
  }
}

export function getLightSchedule() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setLightSchedule(schedule) {
  localStorage.setItem(LS_KEY, JSON.stringify(schedule, null, 2));
}

export function defaultLightSchedule() {
  return {
    enabled: false,

    // Sunrise ramp: intensity 0 -> 100, color start->end
    sunriseStart: "05:00",
    sunriseEnd: "09:00",
    sunriseColorStart: "#fff08a", // warm yellow
    sunriseColorEnd: "#ff3b30",   // warm red

    // Optional sunset ramp: intensity 100 -> 0, color end->start (or custom)
    // If you don't want sunset behavior yet, set sunsetEnabled:false.
    sunsetEnabled: false,
    sunsetStart: "18:00",
    sunsetEnd: "21:00",
    sunsetColorStart: "#ff3b30",
    sunsetColorEnd: "#fff08a",

    // Safety: how often to update (ms)
    tickMs: 20000,
  };
}

function computeRamp(minNow, startMin, endMin) {
  // Returns t in [0..1] if inside interval, else null.
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  if (endMin <= startMin) return null;
  if (minNow < startMin || minNow > endMin) return null;
  return clamp01((minNow - startMin) / (endMin - startMin));
}

function roundPct(x) {
  return Math.round(x);
}

export function computeScheduledOutput(schedule, minNow) {
  // Returns either null (no schedule action) or { enabled, intensity, color }
  const srS = parseHHMM(schedule?.sunriseStart);
  const srE = parseHHMM(schedule?.sunriseEnd);

  const tSunrise = computeRamp(minNow, srS, srE);
  if (tSunrise !== null) {
    return {
      enabled: true,
      intensity: roundPct(lerp(0, 100, tSunrise)),
      color: lerpColor(schedule.sunriseColorStart, schedule.sunriseColorEnd, tSunrise),
      reason: "sunrise",
    };
  }

  if (schedule?.sunsetEnabled) {
    const ssS = parseHHMM(schedule?.sunsetStart);
    const ssE = parseHHMM(schedule?.sunsetEnd);
    const tSunset = computeRamp(minNow, ssS, ssE);
    if (tSunset !== null) {
      // ramp DOWN 100 -> 0
      return {
        enabled: true,
        intensity: roundPct(lerp(100, 0, tSunset)),
        color: lerpColor(schedule.sunsetColorStart, schedule.sunsetColorEnd, tSunset),
        reason: "sunset",
      };
    }
  }

  return null;
}

let controllerTimer = null;
let lastSent = { enabled: null, intensity: null, color: null };

export function startLightController() {
  if (controllerTimer) return;

  const schedule = getLightSchedule() || defaultLightSchedule();

  const tickMs = Number(schedule.tickMs) > 2000 ? Number(schedule.tickMs) : 20000;

  controllerTimer = setInterval(async () => {
    try {
      const s = getLightSchedule() || schedule;
      if (!s.enabled) return;

      const out = computeScheduledOutput(s, minutesNowLocal());
      if (!out) return;

      // Avoid spamming server if nothing changed
      const enabled = !!out.enabled;
      const intensity = clampInt(Number(out.intensity), 0, 100);
      const color = String(out.color || "#000000");

      const changed =
        enabled !== lastSent.enabled ||
        intensity !== lastSent.intensity ||
        color !== lastSent.color;

      if (!changed) return;

      await postIlluminationSettings({ enabled, intensity, color });

      lastSent = { enabled, intensity, color };
      // Optional: expose for UI
      window.application = window.application || {};
      window.application.lightSchedule = { ...s, lastApplied: { enabled, intensity, color, reason: out.reason, at: Date.now() } };
    } catch (e) {
      // Keep quiet-ish; UI can show this if you want later
      console.warn("LightController tick failed:", e?.message || e);
    }
  }, tickMs);
}

export function stopLightController() {
  if (controllerTimer) clearInterval(controllerTimer);
  controllerTimer = null;
}