// src/server/control/temp_controller.js

export function createTempController({
  pollMs,
  thermostat,
  processState,
  getControlSettings,      // async () => ({ updatedAt, settings })
  safeErrorMessage,        // (e) => string
  toNumberOrNull,          // (v) => number|null
}) {
  // ---------- Stability detector (2 minutes window)
  const STABLE_RANGE_C = 0.2;
  const STABLE_MEAN_BAND_C = 0.1;
  const STABLE_WINDOW_MS = 2 * 60 * 1000;

  const tempWindow = []; // { ts, tempC }

  function updateTempStability(tempC, targetC) {
    const now = Date.now();

    if (!Number.isFinite(tempC) || !Number.isFinite(targetC)) {
      processState.stableTemp = false;
      processState.readyToInoculate = false;
      return;
    }

    tempWindow.push({ ts: now, tempC });

    while (tempWindow.length && (now - tempWindow[0].ts) > STABLE_WINDOW_MS) {
      tempWindow.shift();
    }

    const minCount = Math.max(5, Math.floor((STABLE_WINDOW_MS / pollMs) * 0.6));
    if (tempWindow.length < minCount) {
      processState.stableTemp = false;
      processState.readyToInoculate = false;
      return;
    }

    let min = Infinity, max = -Infinity, sum = 0;
    for (const p of tempWindow) {
      min = Math.min(min, p.tempC);
      max = Math.max(max, p.tempC);
      sum += p.tempC;
    }
    const mean = sum / tempWindow.length;

    const rangeOk = (max - min) <= STABLE_RANGE_C;
    const meanOk = Math.abs(mean - targetC) <= STABLE_MEAN_BAND_C;

    processState.stableTemp = rangeOk && meanOk;
    processState.readyToInoculate = (processState.phase === "PREPARING") && processState.stableTemp;
  }

  // ---------- Simple PID (temperature → thermostat output)
  const pid = { lastTs: null, integral: 0, lastErr: 0 };
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // Cache control settings so we don't hit DB every poll
  let controlCache = { updatedAt: null, settings: {} };
  let controlCacheTs = 0;

  async function getCachedControlSettings() {
    const now = Date.now();
    if (now - controlCacheTs < 10_000 && controlCache) return controlCache; // refresh every 10s
    const latest = await getControlSettings();
    controlCache = latest;
    controlCacheTs = now;
    return controlCache;
  }

  // Uses your control.js field names:
  // T_Kp, T_Ki, T_Kd, Thermostat_MAX_PCT
  async function getTempPidConfig() {
    const { settings } = await getCachedControlSettings();

    const kp = Number(settings?.T_Kp ?? 10);
    const ki = Number(settings?.T_Ki ?? 0.2);
    const kd = Number(settings?.T_Kd ?? 0);
    const maxPct = Number(settings?.Thermostat_MAX_PCT ?? 100);

    const safeMax = clamp(maxPct, 0, 100);
    return { kp, ki, kd, maxPct: safeMax, minPct: -safeMax };
  }

  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  // Apply PID output to thermostat:
  // + => heat (mode 1), - => cool (mode 2)
  async function applyTempControl(tempC, targetC) {
    if (!processState.controlEnabled) return;
    if (!Number.isFinite(tempC) || !Number.isFinite(targetC)) return;

    const now = Date.now();
    const dt = pid.lastTs ? (now - pid.lastTs) / 1000 : (pollMs / 1000);
    pid.lastTs = now;

    const err = targetC - tempC; // + => need heat
    pid.integral += err * dt;
    pid.integral = clamp(pid.integral, -200, 200);

    const dErr = dt > 0 ? (err - pid.lastErr) / dt : 0;
    pid.lastErr = err;

    const { kp, ki, kd, minPct, maxPct } = await getTempPidConfig();

    let out = (kp * err) + (ki * pid.integral) + (kd * dErr);
    out = clamp(out, minPct, maxPct);

    // Convert to thermostat command
    const absPct = round1(clamp(Math.abs(out), 0, 100)); // ✅ 1 decimal

    try {
      if (absPct < 0.5) {
        thermostat.setMode(0);
        thermostat.setPercentage(0);
      } else if (out > 0) {
        thermostat.setMode(1); // Heat
        thermostat.setPercentage(absPct);
      } else {
        thermostat.setMode(2); // Cool
        thermostat.setPercentage(absPct);
      }
    } catch (e) {
      console.error("Temp control failed:", safeErrorMessage(e));
    }
  }

  function reset() {
    tempWindow.length = 0;
    processState.readyToInoculate = false;
    processState.stableTemp = false;
    pid.lastTs = null;
    pid.integral = 0;
    pid.lastErr = 0;
  }

  // Call this once per poll after you updated ezortd/thermostat etc.
  async function tick({ tempC }) {
    const targetC = Number(processState.settings.targetTempC);

    if (processState.phase !== "IDLE") {
      updateTempStability(tempC, targetC);
      await applyTempControl(tempC, targetC);
    } else {
      processState.readyToInoculate = false;
      processState.stableTemp = false;
    }
  }

  return {
    tick,
    reset,
    toNumberOrNull, // (optional) just re-export if you want
  };
}