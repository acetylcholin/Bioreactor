// src/server/db/process_store.js
//
// This file is your "fermentation historian storage layer".
// main.js calls these functions to create batches, store batch settings,
// mark start/stop, and log time-series snapshots.
//
// KEY IDEA:
// - Batch metadata / settings = stored occasionally (few rows)
// - Time-series sensor snapshot = stored every poll (many rows)
// - Static device info (identity, calibration strings, portPath, etc) = should NOT be stored every poll
//
// We keep your existing tables, and we add ONE OPTIONAL table writer
// for static data (if you choose to add that table).
//
// If you don't want a new table right now, you can still use the helper
// `splitSnapshotStaticDynamic()` to strip static fields before calling logSnapshot().

export async function ensureBatch(db, batchNumber, operator = "", notes = "") {
  // Called when user presses "Save" (POST /api/process/settings)
  // Goal: ensure a row exists in `batches` for this batchNumber.
  const now = Date.now();

  const existing = await db.get(`SELECT * FROM batches WHERE batchNumber = ?`, [batchNumber]);
  if (existing) {
    // update operator/notes if provided
    if (operator || notes) {
      await db.run(
        `UPDATE batches SET operator = COALESCE(NULLIF(?,''), operator),
                            notes    = COALESCE(NULLIF(?,''), notes)
         WHERE id = ?`,
        [operator || "", notes || "", existing.id]
      );
    }
    return await db.get(`SELECT * FROM batches WHERE id = ?`, [existing.id]);
  }

  // Create new batch row
  const ins = await db.run(
    `INSERT INTO batches(batchNumber, operator, notes, createdAt, status)
     VALUES(?,?,?,?, 'IDLE')`,
    [batchNumber, operator || "", notes || "", now]
  );

  return await db.get(`SELECT * FROM batches WHERE id = ?`, [ins.lastID]);
}

export async function saveBatchSettings(db, batchId, settingsObj) {
  // Called when user presses "Save" (POST /api/process/settings)
  // Goal: store batch recipe/targets/settings as a HISTORY row (batch_settings).
  // This is NOT time-series (not every 3 sec).
  const now = Date.now();
  await db.run(
    `INSERT INTO batch_settings(batchId, savedAt, settingsJson) VALUES(?,?,?)`,
    [batchId, now, JSON.stringify(settingsObj)]
  );
}

export async function getLatestSettings(db, batchId) {
  const row = await db.get(
    `SELECT settingsJson FROM batch_settings WHERE batchId = ? ORDER BY savedAt DESC LIMIT 1`,
    [batchId]
  );
  return row ? JSON.parse(row.settingsJson) : null;
}

export async function startBatch(db, batchId) {
  // Called when user presses "Inoculate" (POST /api/process/inoculate)
  // Marks fermentation as RUNNING and sets startedAt (only once).
  const now = Date.now();
  await db.run(
    `UPDATE batches
       SET status='RUNNING',
           startedAt=COALESCE(startedAt, ?),
           stoppedAt=NULL
     WHERE id=?`,
    [now, batchId]
  );
  return now; // returned as t0 reference
}

export async function stopBatch(db, batchId) {
  // Called when user presses "Stop" (POST /api/process/stop)
  // Marks fermentation as STOPPED and sets stoppedAt.
  const now = Date.now();
  await db.run(
    `UPDATE batches SET status='STOPPED', stoppedAt=? WHERE id=?`,
    [now, batchId]
  );
  return now;
}

/* =========================================================
   STATIC vs DYNAMIC snapshot handling
   ========================================================= */

/**
 * Splits a big snapshot into:
 * - dynamic: values that change often (good for 3-sec historian)
 * - static: identity / calibration / metadata that usually doesn't change
 *
 * This does NOT write anything. It's a helper that main.js can use.
 *
 * Why: you currently store everything in sensor_log every 3 sec.
 * That creates a very large DB for long batches.
 */
export function splitSnapshotStaticDynamic(snapshotObj) {
  const s = snapshotObj || {};

  // dynamic: numeric/operational state you want over time
  const dynamic = {
    ezortdSensor: pick(s.ezortdSensor, ["status", "value", "unit", "error", "updatedAt"]),
    ezophSensor: pick(s.ezophSensor, ["status", "value", "unit", "compTempC", "error", "updatedAt"]),
    thermostat: pick(s.thermostat, ["status", "mode", "percentage", "voltage", "current", "power", "error", "updatedAt"]),
    stirring: pick(s.stirring, ["status", "rpm", "unit", "error", "updatedAt"]),
    pumps: {
      status: s.pumps?.status,
      error: s.pumps?.error,
      updatedAt: s.pumps?.updatedAt,
      pumps: {
        acid: pick(s.pumps?.pumps?.acid, ["status", "rpm", "mlh", "sumML", "updatedAt", "error"]),
        base: pick(s.pumps?.pumps?.base, ["status", "rpm", "mlh", "sumML", "updatedAt", "error"]),
        feed: pick(s.pumps?.pumps?.feed, ["status", "rpm", "mlh", "sumML", "updatedAt", "error"]),
        antifoam: pick(s.pumps?.pumps?.antifoam, ["status", "rpm", "mlh", "sumML", "updatedAt", "error"]),
      },
    },
    illumination: {
      status: s.illumination?.status,
      error: s.illumination?.error,
      updatedAt: s.illumination?.updatedAt,
      // dynamic light state during fermentation:
      settings: pick(s.illumination?.settings, ["enabled", "intensity", "color"]),
    },

    // process is NOT really time-series sensor data. Optional:
    // Keep only running/t0 here if you want.
    process: pick(s.process, ["running", "t0"]),
  };

  // static: identity, calibration strings, portPath, device info (rarely changes)
  const staticInfo = {
    ezortdSensor: pick(s.ezortdSensor, ["id", "calibrationStatus"]),
    ezophSensor: pick(s.ezophSensor, ["id", "calibrationStatus", "slope", "internalTemperature"]),
    thermostat: pick(s.thermostat, ["id"]),
    pumps: {
      id: s.pumps?.id,
      address: s.pumps?.address,
      pumps: {
        acid: pick(s.pumps?.pumps?.acid, ["pumpid", "name", "calibrationStatus", "id"]),
        base: pick(s.pumps?.pumps?.base, ["pumpid", "name", "calibrationStatus", "id"]),
        feed: pick(s.pumps?.pumps?.feed, ["pumpid", "name", "calibrationStatus", "id"]),
        antifoam: pick(s.pumps?.pumps?.antifoam, ["pumpid", "name", "calibrationStatus", "id"]),
      },
    },
    stirring: pick(s.stirring, ["id", "gpioPin"]),
    illumination: pick(s.illumination, ["id", "identity", "portPath"]),
  };

  // Remove empty keys (optional)
  return { dynamic: pruneEmpty(dynamic), staticInfo: pruneEmpty(staticInfo) };
}

function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return undefined;
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return Object.keys(out).length ? out : undefined;
}

function pruneEmpty(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const pv = pruneEmpty(v);
      if (pv && Object.keys(pv).length) out[k] = pv;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* =========================================================
   TIME-SERIES historian logging (every poll while running)
   ========================================================= */

export async function logSnapshot(db, batchId, snapshotObj) {
  // Called from poll loop every 3 seconds (only when processState.running && activeBatchId).
  // Writes to sensor_log (many rows).
  const now = Date.now();
  await db.run(
    `INSERT INTO sensor_log(batchId, ts, snapshotJson) VALUES(?,?,?)`,
    [batchId, now, JSON.stringify(snapshotObj)]
  );
}

/* =========================================================
   OPTIONAL: STATIC device info logging (once per batch)
   =========================================================
   If you want static info stored only once per batch, add a table:

   CREATE TABLE IF NOT EXISTS batch_static (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     batchId INTEGER NOT NULL,
     savedAt INTEGER NOT NULL,
     staticJson TEXT NOT NULL,
     FOREIGN KEY(batchId) REFERENCES batches(id)
   );

   Then you can call saveBatchStatic(db, batchId, staticInfo)
   at Inoculate time or immediately after the first snapshot.
*/

export async function saveBatchStatic(db, batchId, staticObj) {
  // Intended to be called ONCE per batch (e.g. right after inoculate).
  // Requires table `batch_static` to exist.
  const now = Date.now();
  await db.run(
    `INSERT INTO batch_static(batchId, savedAt, staticJson) VALUES(?,?,?)`,
    [batchId, now, JSON.stringify(staticObj)]
  );
}

/* =========================================================
   Helpers for visualization (read from DB)
   ========================================================= */

export async function listBatches(db, limit = 200) {
  return db.all(
    `SELECT id, batchNumber, status, createdAt, startedAt, stoppedAt
     FROM batches
     ORDER BY id DESC
     LIMIT ?`,
    [Number(limit) || 200]
  );
}

export async function getBatchById(db, batchId) {
  return db.get(
    `SELECT id, batchNumber, operator, notes, status, createdAt, startedAt, stoppedAt
     FROM batches
     WHERE id = ?`,
    [Number(batchId)]
  );
}

export async function getSensorPoints(db, batchId, limit = 600) {
  // Reads time-series rows from sensor_log (many rows).
  const lim = Math.max(10, Math.min(3000, Number(limit) || 600));
  const rows = await db.all(
    `SELECT ts, snapshotJson
     FROM sensor_log
     WHERE batchId = ?
     ORDER BY ts DESC
     LIMIT ?`,
    [Number(batchId), lim]
  );

  rows.reverse();

  return rows.map(r => ({
    ts: r.ts,
    snapshot: JSON.parse(r.snapshotJson),
  }));
}