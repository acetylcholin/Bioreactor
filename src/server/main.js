// src/server/main.js
import express from "express";
import http from "http";
import path from "path";
import fs from "node:fs/promises";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createRequire } from "module";

import { mountCameraRoutes } from "./routes/camera.js";

import { processState } from "./runtime/process_state.js";

// Routes
import { mountDbAdminRoutes } from "./routes/db_admin.js";

// Control
import { createTempController } from "./control/temp_controller.js";

// Devices
import EzortdDevice from "./devices/temperature/ezo_rtd/device.js";
import EzophDevice from "./devices/ph/ezo_ph/device.js";
import EzOecDevice from "./devices/ec/ezo_ec/device.js";
import ThermostatDevice from "./devices/thermostat/device.js";
import ParallaxPumpBoard from "./devices/pumps/parallax/device.js";
import StirringDevice from "./devices/stirring/device.js";
import IlluminationDevice from "./devices/illumination/device.js";

// DB
import { initDb } from "./db/db.js";
import {
  ensureBatch,
  saveBatchSettings,
  stopBatch,
  logSnapshot,
  splitSnapshotStaticDynamic,
  saveBatchStatic,
} from "./db/process_store.js";

// ---- Crash visibility
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const POLL_MS = process.env.POLL_MS ? Number(process.env.POLL_MS) : 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// IMPORTANT: this assumes folder layout:
//   server/main.js
//   client/index.html
const CLIENT_DIR = path.resolve(__dirname, "../client");

// Persist active batch across restarts
const ACTIVE_FILE = path.resolve(__dirname, "./db/active_batch.json");

// ==============================
// Camera Timelapse (server-side)
// ==============================
const CAMERA_DEV =
  process.env.CAMERA_DEV || "/dev/v4l/by-id/usb-046d_HD_Webcam_C270-video-index0";
const CAMERA_SIZE = process.env.CAMERA_SIZE || "1280x720";
const CAMERA_FPS = process.env.CAMERA_FPS || "10";
const PICTURES_DIR =
  process.env.PICTURES_DIR || path.resolve(__dirname, "../pictures");

function clampIntSafe(x, a, b) {
  const n = Math.round(Number(x) || 0);
  return Math.max(a, Math.min(b, n));
}

async function ensureDir(p) {
  try {
    await fs.mkdir(p, { recursive: true });
  } catch {}
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTsForFilename(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

async function captureSnapshotToFile({ outPath }) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "v4l2",
    "-input_format",
    "mjpeg",
    "-framerate",
    String(CAMERA_FPS),
    "-video_size",
    String(CAMERA_SIZE),
    "-i",
    String(CAMERA_DEV),
    "-frames:v",
    "1",
    "-q:v",
    "4",
    "-y",
    outPath,
  ];

  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));

    ff.on("error", (e) => reject(e));
    ff.on("close", (code) => {
      if (code === 0) return resolve();
      reject(
        new Error(`ffmpeg snapshot failed (code=${code}): ${stderr.trim()}`)
      );
    });
  });
}

// -------- Helpers
function safeErrorMessage(e) {
  return e && e.message ? e.message : String(e);
}
function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function round1(x) {
  return Math.round(x * 10) / 10;
}

async function readActiveBatchFile() {
  try {
    const raw = await fs.readFile(ACTIVE_FILE, "utf8");
    const j = JSON.parse(raw);
    return {
      activeBatchId: Number.isFinite(Number(j.activeBatchId))
        ? Number(j.activeBatchId)
        : null,
      batchNumber: typeof j.batchNumber === "string" ? j.batchNumber : "",
      running: !!j.running,
      t0: Number.isFinite(Number(j.t0)) ? Number(j.t0) : null,
    };
  } catch {
    return { activeBatchId: null, batchNumber: "", running: false, t0: null };
  }
}

async function writeActiveBatchFile({ activeBatchId, batchNumber, running, t0 }) {
  const data = {
    activeBatchId: activeBatchId ?? null,
    batchNumber: batchNumber || "",
    running: !!running,
    t0: t0 ?? null,
    updatedAt: Date.now(),
  };
  try {
    await fs.writeFile(ACTIVE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to write active batch file:", safeErrorMessage(e));
  }
}

/**
 * Build a snapshot that never crashes if a device is missing/failed.
 */
function buildDevicesSnapshot(
  ezortd,
  ezoph,
  ezoec,
  thermostat,
  pumpBoard,
  stirring,
  illumination
) {
  const devices = {};

  // RTD
  if (ezortd) {
    try {
      const j = ezortd.toJSON();
      if (ezortd.error && !j.error) j.error = ezortd.error;
      devices.ezortdSensor = j;
    } catch (e) {
      devices.ezortdSensor = {
        id: "ezortdSensor",
        status: "failed",
        value: null,
        unit: "°C",
        error: safeErrorMessage(e),
        updatedAt: Date.now(),
      };
    }
  }

  // pH
  if (ezoph) {
    try {
      const j = ezoph.toJSON();
      if (ezoph.error && !j.error) j.error = ezoph.error;
      devices.ezophSensor = j;
    } catch (e) {
      devices.ezophSensor = {
        id: "ezophSensor",
        status: "failed",
        value: null,
        unit: "pH",
        error: safeErrorMessage(e),
        updatedAt: Date.now(),
      };
    }
  }

  // EC
  if (ezoec) {
    try {
      const j = ezoec.toJSON();
      if (ezoec.error && !j.error) j.error = ezoec.error;
      // (optional) unit field if your device doesn't include it
      if (!j.unit) j.unit = "mS/cm";
      devices.ezoecSensor = j;
    } catch (e) {
      devices.ezoecSensor = {
        id: "ezoecSensor",
        status: "failed",
        value: null,
        unit: "mS/cm",
        calibrationStatus: "—",
        error: safeErrorMessage(e),
        updatedAt: Date.now(),
      };
    }
  }

  // Thermostat
  if (thermostat) {
    try {
      const j = thermostat.toJSON();
      if (thermostat.error && !j.error) j.error = thermostat.error;
      devices.thermostat = j;
    } catch (e) {
      devices.thermostat = {
        id: "thermostat",
        status: "failed",
        mode: 0,
        percentage: 0,
        voltage: null,
        current: null,
        power: null,
        error: safeErrorMessage(e),
        updatedAt: Date.now(),
      };
    }
  }

  // Pumps
  if (pumpBoard) {
    try {
      const j = pumpBoard.toJSON();
      if (pumpBoard.error && !j.error) j.error = pumpBoard.error;
      if (pumpBoard.status && !j.status) j.status = pumpBoard.status;
      devices.pumps = j;
    } catch (e) {
      devices.pumps = {
        id: "-",
        status: "failed",
        address: "0x10",
        error: safeErrorMessage(e),
        pumps: {},
        updatedAt: Date.now(),
      };
    }
  }

  // Stirring
  if (stirring) {
    try {
      const j = stirring.toJSON();
      if (stirring.error && !j.error) j.error = stirring.error;
      devices.stirring = j;
    } catch (e) {
      devices.stirring = {
        id: "stirring",
        status: "failed",
        rpm: 0,
        unit: "RPM",
        gpioPin: 19,
        error: safeErrorMessage(e),
        updatedAt: Date.now(),
      };
    }
  }

  // Illumination
  if (illumination) {
    try {
      const j = illumination.toJSON();
      if (illumination.error && !j.error) j.error = illumination.error;
      devices.illumination = j;
    } catch (e) {
      devices.illumination = {
        id: "illumination",
        status: "failed",
        rgb: "#000000",
        error: safeErrorMessage(e),
        updatedAt: Date.now(),
      };
    }
  }

  // Process state for UI
  devices.process = {
    phase: processState.phase,
    running: processState.running,
    controlEnabled: processState.controlEnabled,
    t0: processState.t0,
    readyToInoculate: processState.readyToInoculate,
    stableTemp: processState.stableTemp,
    settings: processState.settings,
  };

  return devices;
}

async function main() {
  /* =========================
     1) DB init
     ========================= */
  const db = await initDb();

  // Optional table: static once per batch
  await db.run(`
    CREATE TABLE IF NOT EXISTS batch_static (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId INTEGER NOT NULL,
      savedAt INTEGER NOT NULL,
      staticJson TEXT NOT NULL,
      FOREIGN KEY(batchId) REFERENCES batches(id)
    );
  `);

  // Ensure inoculatedAt exists
  async function ensureInoculatedAtColumn() {
    const cols = await db.all(`PRAGMA table_info(batches)`);
    const has = cols.some((c) => c.name === "inoculatedAt");
    if (!has) {
      await db.run(`ALTER TABLE batches ADD COLUMN inoculatedAt INTEGER`);
      console.log("DB: added batches.inoculatedAt");
    }
  }
  await ensureInoculatedAtColumn();

  // Global control settings
  async function getControlSettings() {
    const row = await db.get(
      `SELECT updatedAt, settingsJson FROM control_settings WHERE id = 1`
    );
    if (!row) return { updatedAt: null, settings: {} };
    return { updatedAt: row.updatedAt, settings: JSON.parse(row.settingsJson) };
  }

  // Serialize DB writes
  let dbQueue = Promise.resolve();
  function runDbExclusive(fn) {
    dbQueue = dbQueue.then(fn, fn);
    return dbQueue;
  }

  /* =========================
     2) Restore active batch
     ========================= */
  let activeBatchId = null;
  const prev = await readActiveBatchFile();

  if (prev.batchNumber) processState.settings.batchNumber = prev.batchNumber;

  if (prev.running) {
    processState.running = true;
    processState.controlEnabled = true;
    processState.t0 = prev.t0 || null;
    processState.phase = processState.t0 ? "RUNNING" : "PREPARING";
    activeBatchId = prev.activeBatchId;

    console.log("Restored active batch from file:", {
      activeBatchId,
      batchNumber: prev.batchNumber,
      phase: processState.phase,
    });
  }

  let staticSavedForBatchId = null;

  /* =========================
     3) Devices
     ========================= */
  const ezortd = new EzortdDevice();
  const ezoph = new EzophDevice();
  const ezoec = new EzOecDevice();
  const thermostat = new ThermostatDevice();
  const pumpBoard = new ParallaxPumpBoard();
  const stirring = new StirringDevice({ gpioPin: 19 });
  const illumination = new IlluminationDevice();

  try {
    await ezortd.initialize();
  } catch (e) {
    ezortd.status = "failed";
    ezortd.error = safeErrorMessage(e);
    console.error("RTD init failed:", ezortd.error);
  }
  try {
    await ezoph.initialize();
  } catch (e) {
    ezoph.status = "failed";
    ezoph.error = safeErrorMessage(e);
    console.error("pH init failed:", ezoph.error);
  }
  try {
    await ezoec.initialize();
  } catch (e) {
    ezoec.status = "failed";
    ezoec.error = safeErrorMessage(e);
    console.error("EC init failed:", ezoec.error);
  }
  try {
    await thermostat.initialize();
  } catch (e) {
    thermostat.status = "failed";
    thermostat.error = safeErrorMessage(e);
    console.error("Thermostat init failed:", thermostat.error);
  }
  try {
    await pumpBoard.initialize();
  } catch (e) {
    pumpBoard.status = "failed";
    pumpBoard.error = safeErrorMessage(e);
    console.error("Pump board init failed:", pumpBoard.error);
  }
  try {
    await stirring.initialize();
  } catch (e) {
    stirring.status = "failed";
    stirring.error = safeErrorMessage(e);
    console.error("Stirring init failed:", stirring.error);
  }
  try {
    await illumination.initialize();
  } catch (e) {
    illumination.status = "failed";
    illumination.error = safeErrorMessage(e);
    console.error("Illumination init failed:", illumination.error);
  }

  /* =========================
     4) Temp controller
     ========================= */
  const tempController = createTempController({
    pollMs: POLL_MS,
    thermostat,
    processState,
    getControlSettings,
    safeErrorMessage,
    toNumberOrNull,
  });

  /* =========================
     5) Web server
     ========================= */
  const app = express();
  app.use(express.json());

  // ---- serve client
  app.use(express.static(CLIENT_DIR));

  // ✅ Backward compat: old HTML referenced "/styles.css"
  app.get("/styles.css", (req, res) => {
    res.type("text/css");
    res.sendFile(path.join(CLIENT_DIR, "styles", "app.css"));
  });

  // ✅ Backward compat: old HTML referenced "/db_admin.js"
  app.get("/db_admin.js", (req, res) => {
    res.type("application/javascript");
    res.sendFile(path.join(CLIENT_DIR, "pages", "db_admin.js"));
  });

  // ✅ Backward compat: some pages used "/visualization.js"
  app.get("/visualization.js", (req, res) => {
    res.type("application/javascript");
    res.sendFile(path.join(CLIENT_DIR, "pages", "visualization.js"));
  });

  // Index
  app.get("/", (req, res) =>
    res.sendFile(path.join(CLIENT_DIR, "index.html"))
  );

  // ✅ Mount DB admin routes (/api/db/*)
  mountDbAdminRoutes(app, {
    db,
    runDbExclusive,
    processState,
    getActiveBatchId: () => activeBatchId,
    baseDir: __dirname,
  });

  // ✅ Camera routes
  await mountCameraRoutes(app);

  // ✅ OFFLINE Chart.js
  const require = createRequire(import.meta.url);
  app.get("/vendor/chart.umd.min.js", (req, res) => {
    try {
      let chartPath = null;

      if (typeof import.meta.resolve === "function") {
        const entryUrl = import.meta.resolve("chart.js");
        const entryPath = fileURLToPath(entryUrl);
        const distDir = path.dirname(entryPath);
        chartPath = path.join(distDir, "chart.umd.min.js");
      } else {
        chartPath = path.resolve(
          __dirname,
          "../node_modules/chart.js/dist/chart.umd.min.js"
        );
      }

      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.sendFile(chartPath);
    } catch (e) {
      console.error("Chart.js vendor route failed:", e);
      res.status(500).send("Chart.js not found. Run: npm install chart.js");
    }
  });

  /* =========================
     6) Process APIs
     ========================= */
  app.post("/api/process/settings", async (req, res) => {
    try {
      const s = req.body || {};
      const batchNumber = (s.batchNumber || "").trim();
      if (!batchNumber) throw new Error("batchNumber is required");

      const batch = await runDbExclusive(() =>
        ensureBatch(db, batchNumber, s.operator || "", s.notes || "")
      );
      activeBatchId = batch.id;

      processState.settings = { ...processState.settings, ...s };
      await runDbExclusive(() =>
        saveBatchSettings(db, batch.id, processState.settings)
      );

      staticSavedForBatchId = null;

      await writeActiveBatchFile({
        activeBatchId,
        batchNumber: processState.settings.batchNumber,
        running: processState.running,
        t0: processState.t0,
      });

      res.json({ ok: true, batchId: batch.id });
    } catch (e) {
      console.error("SETTINGS failed:", e);
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/process/start", async (req, res) => {
    try {
      const batchNumber = (processState.settings.batchNumber || "").trim();
      if (!batchNumber) throw new Error("Set batchNumber first, then Save.");

      const batch = await runDbExclusive(() =>
        ensureBatch(
          db,
          batchNumber,
          processState.settings.operator || "",
          processState.settings.notes || ""
        )
      );
      activeBatchId = batch.id;

      await runDbExclusive(async () => {
        const now = Date.now();
        const row = await db.get(`SELECT startedAt FROM batches WHERE id = ?`, [
          batch.id,
        ]);
        const startedAt = row?.startedAt ? row.startedAt : now;

        await db.run(
          `UPDATE batches SET status = ?, startedAt = ? WHERE id = ?`,
          ["PREPARING", startedAt, batch.id]
        );
      });

      processState.phase = "PREPARING";
      processState.running = true;
      processState.controlEnabled = true;
      processState.t0 = null;

      tempController.reset();
      staticSavedForBatchId = null;

      await writeActiveBatchFile({
        activeBatchId,
        batchNumber: processState.settings.batchNumber,
        running: true,
        t0: null,
      });

      res.json({ ok: true, batchId: activeBatchId });
    } catch (e) {
      console.error("START failed:", e);
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/process/inoculate", async (req, res) => {
    try {
      const batchNumber = (processState.settings.batchNumber || "").trim();
      if (!batchNumber) throw new Error("Set batchNumber first, then Save.");

      const batch = await runDbExclusive(() =>
        ensureBatch(
          db,
          batchNumber,
          processState.settings.operator || "",
          processState.settings.notes || ""
        )
      );
      activeBatchId = batch.id;

      if (processState.phase === "IDLE") {
        processState.phase = "PREPARING";
        processState.running = true;
        processState.controlEnabled = true;
      }

      if (processState.phase === "PREPARING" && !processState.readyToInoculate) {
        throw new Error("Not ready to inoculate yet (temperature not stable).");
      }

      const t0 = Date.now();

      await runDbExclusive(async () => {
        const row = await db.get(`SELECT startedAt FROM batches WHERE id = ?`, [
          batch.id,
        ]);
        const startedAt = row?.startedAt ? row.startedAt : Date.now();

        await db.run(
          `UPDATE batches SET status = ?, startedAt = ?, inoculatedAt = ? WHERE id = ?`,
          ["RUNNING", startedAt, t0, batch.id]
        );
      });

      processState.phase = "RUNNING";
      processState.t0 = t0;

      await writeActiveBatchFile({
        activeBatchId,
        batchNumber: processState.settings.batchNumber,
        running: true,
        t0,
      });

      res.json({ ok: true, t0, batchId: activeBatchId });
    } catch (e) {
      console.error("INOCULATE failed:", e);
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/process/stop", async (req, res) => {
    try {
      processState.running = false;
      processState.controlEnabled = false;
      processState.readyToInoculate = false;
      processState.stableTemp = false;
      processState.phase = "IDLE";

      tempController.reset();

      try {
        thermostat.setMode(0);
        thermostat.setPercentage(0);
      } catch (e) {
        console.warn("Thermostat safe-off failed:", safeErrorMessage(e));
      }

      let batchId = activeBatchId;
      if (!batchId) {
        const bn = (processState.settings.batchNumber || "").trim();
        if (bn) {
          const b = await runDbExclusive(() =>
            ensureBatch(
              db,
              bn,
              processState.settings.operator || "",
              processState.settings.notes || ""
            )
          );
          batchId = b.id;
          activeBatchId = batchId;
        }
      }

      if (batchId) await runDbExclusive(() => stopBatch(db, batchId));

      await writeActiveBatchFile({
        activeBatchId: null,
        batchNumber: processState.settings.batchNumber,
        running: false,
        t0: processState.t0,
      });

      activeBatchId = null;
      staticSavedForBatchId = null;

      res.json({
        ok: true,
        warning: batchId ? undefined : "No batchId found; stopped UI only.",
      });
    } catch (e) {
      console.error("STOP failed:", e);
      processState.running = false;
      processState.controlEnabled = false;
      processState.phase = "IDLE";
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  /* =========================
     7) Control settings APIs
     ========================= */
  app.get("/api/control/settings", async (req, res) => {
    try {
      const out = await getControlSettings();
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/control/settings", async (req, res) => {
    try {
      const settings = req.body?.settings || {};
      for (const [k, v] of Object.entries(settings)) {
        if (v === null) continue;
        if (!Number.isFinite(Number(v))) throw new Error(`Invalid number for ${k}`);
      }

      await db.run(
        `UPDATE control_settings SET updatedAt = ?, settingsJson = ? WHERE id = 1`,
        [Date.now(), JSON.stringify(settings)]
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  /* =========================
     8) Templates
     ========================= */
  app.post("/api/templates/save", async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      if (!name) throw new Error("Template name is required");

      await db.run(
        `INSERT INTO templates(name, createdAt, settingsJson) VALUES(?,?,?)`,
        [name, Date.now(), JSON.stringify(processState.settings)]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.get("/api/templates/list", async (req, res) => {
    try {
      const rows = await db.all(
        `SELECT id, name, createdAt FROM templates ORDER BY createdAt DESC`
      );
      res.json({ ok: true, templates: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.get("/api/templates/:id(\\d+)", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = await db.get(
        `SELECT id, name, createdAt, settingsJson FROM templates WHERE id = ?`,
        [id]
      );
      if (!row) throw new Error("Template not found");
      res.json({
        ok: true,
        template: { ...row, settings: JSON.parse(row.settingsJson) },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  /* =========================
     9) Device control APIs
     ========================= */

  // Thermostat
  app.post("/api/thermostat/percentage", (req, res) => {
    try {
      let pct = Number(req.body.percentage);
      if (!Number.isFinite(pct)) throw new Error("percentage must be a number");
      pct = round1(clamp(pct, 0, 100));
      thermostat.setPercentage(pct);
      res.json({ ok: true, percentage: pct });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/thermostat/mode", (req, res) => {
    try {
      thermostat.setMode(req.body.mode);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // Stirring
  app.post("/api/stirring/rpm", async (req, res) => {
    try {
      await stirring.setRPM(req.body.rpm);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // Pumps
  app.post("/api/pumps/:type/rpm", async (req, res) => {
    try {
      await pumpBoard.setRPM(req.params.type, req.body.rpm);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/pumps/:type/mlh", async (req, res) => {
    try {
      await pumpBoard.setMLH(req.params.type, req.body.mlh);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/pumps/:type/calibrate", async (req, res) => {
    try {
      await pumpBoard.calibrate(req.params.type, req.body.rpm, req.body.mlh);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/pumps/:type/clearsum", (req, res) => {
    try {
      pumpBoard.clearSum(req.params.type);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // pH
  app.post("/api/ph/clear", async (req, res) => {
    try {
      await ezoph.clearCalibration();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/ph/calibrate", async (req, res) => {
    try {
      await ezoph.calibrate(req.body.point, req.body.value);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // ✅ EC calibration
  app.post("/api/ec/clear", async (req, res) => {
    try {
      await ezoec.clearCalibration();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/ec/calibrate/dry", async (req, res) => {
    try {
      await ezoec.calibrateDry();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // single point: { value: 1413 } etc (Atlas uses µS/cm typically)
  app.post("/api/ec/calibrate/single", async (req, res) => {
    try {
      const value = Number(req.body?.value);
      if (!Number.isFinite(value) || value <= 0) throw new Error("value must be a positive number");
      await ezoec.calibrateSingle(value);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/ec/calibrate/low", async (req, res) => {
    try {
      const value = Number(req.body?.value);
      if (!Number.isFinite(value) || value <= 0) throw new Error("value must be a positive number");
      await ezoec.calibrateLow(value);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/ec/calibrate/high", async (req, res) => {
    try {
      const value = Number(req.body?.value);
      if (!Number.isFinite(value) || value <= 0) throw new Error("value must be a positive number");
      await ezoec.calibrateHigh(value);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // Temp calibration
  app.post("/api/temp/calibrate", async (req, res) => {
    try {
      await ezortd.calibrate(req.body?.tempC);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/temp/clear", async (req, res) => {
    try {
      await ezortd.clearCalibration();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.get("/api/temp/calstatus", async (req, res) => {
    try {
      const status = await ezortd.refreshCalibrationStatus();
      res.json({ ok: true, status });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // Illumination
  app.post("/api/illumination/rgb", async (req, res) => {
    try {
      await illumination.setRGB(req.body?.rgb);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/illumination/power", async (req, res) => {
    try {
      await illumination.setPower(!!req.body?.enabled);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/illumination/settings", async (req, res) => {
    try {
      await illumination.setSettings(req.body || {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  /* =========================
     10) Visualization APIs
     ========================= */
  app.get("/api/batches/list", async (req, res) => {
    try {
      const rows = await db.all(`
        SELECT id, batchNumber, status, createdAt, startedAt, inoculatedAt, stoppedAt
        FROM batches
        ORDER BY id DESC
        LIMIT 200
      `);
      res.json({ ok: true, batches: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.get("/api/batches/:id(\\d+)", async (req, res) => {
    try {
      const batchId = Number(req.params.id);
      const batch = await db.get(
        `SELECT id, batchNumber, operator, notes, status, createdAt, startedAt, inoculatedAt, stoppedAt
         FROM batches
         WHERE id = ?`,
        [batchId]
      );
      if (!batch) return res.status(404).json({ ok: false, error: "Batch not found" });
      res.json({ ok: true, batch });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.get("/api/batches/:id(\\d+)/sensor", async (req, res) => {
    try {
      const batchId = Number(req.params.id);
      const limit = Math.max(10, Math.min(3000, Number(req.query.limit) || 600));
      const rows = await db.all(
        `SELECT ts, snapshotJson
         FROM sensor_log
         WHERE batchId = ?
         ORDER BY ts DESC
         LIMIT ?`,
        [batchId, limit]
      );
      rows.reverse();
      const points = rows.map((r) => ({ ts: r.ts, snapshot: JSON.parse(r.snapshotJson) }));
      res.json({ ok: true, points });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  function csvEscape(v) {
    const s = v === undefined || v === null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  app.get("/api/batches/:id(\\d+)/export.csv", async (req, res) => {
    try {
      const batchId = Number(req.params.id);

      const batch = await db.get(`SELECT batchNumber FROM batches WHERE id = ?`, [batchId]);
      if (!batch) return res.status(404).json({ ok: false, error: "Batch not found" });

      const rows = await db.all(
        `SELECT ts, snapshotJson
         FROM sensor_log
         WHERE batchId = ?
         ORDER BY ts ASC`,
        [batchId]
      );

      const header = [
        "ts",
        "iso",
        "tempC",
        "pH",
        "ec",
        "thermostat_mode",
        "thermostat_pct",
        "thermostat_powerW",
        "stirring_rpm",
      ];

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${batch.batchNumber}_sensor_log.csv"`
      );

      res.write(header.join(",") + "\n");

      for (const r of rows) {
        const ts = r.ts;
        const iso = new Date(ts).toISOString();
        const snap = JSON.parse(r.snapshotJson);

        const tempC = snap?.ezortdSensor?.value ?? "";
        const pH = snap?.ezophSensor?.value ?? "";
        const ec = snap?.ezoecSensor?.value ?? "";
        const tMode = snap?.thermostat?.mode ?? "";
        const tPct = snap?.thermostat?.percentage ?? "";
        const tPow = snap?.thermostat?.power ?? "";
        const stir = snap?.stirring?.rpm ?? "";

        const line = [ts, iso, tempC, pH, ec, tMode, tPct, tPow, stir]
          .map(csvEscape)
          .join(",");
        res.write(line + "\n");
      }

      res.end();
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  /* =========================
     11) HTTP + WebSocket
     ========================= */
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  function broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  wss.on("connection", (ws) => {
    ws.send(
      JSON.stringify({
        type: "devices",
        data: buildDevicesSnapshot(
          ezortd,
          ezoph,
          ezoec,
          thermostat,
          pumpBoard,
          stirring,
          illumination
        ),
      })
    );
  });

  server.listen(PORT, () => {
    console.log(`Web UI: http://<raspberrypi-ip>:${PORT}`);
    console.log(`Serving client from: ${CLIENT_DIR}`);
    console.log(`Poll interval: ${POLL_MS} ms`);
    console.log(`Chart.js (offline): http://<raspberrypi-ip>:${PORT}/vendor/chart.umd.min.js`);
  });

  /* =========================
     12) Poll loop
     ========================= */
  let polling = false;

  setInterval(async () => {
    if (polling) return;
    polling = true;

    try {
      // 1) RTD
      try {
        await ezortd.update();
        ezortd.status = "Ok";
        ezortd.error = "";
      } catch (e) {
        ezortd.status = "failed";
        ezortd.error = safeErrorMessage(e);
        console.error("RTD update failed:", ezortd.error);
      }
      const tempC = toNumberOrNull(ezortd.value);

      // 2) pH (temp-comp)
      try {
        await ezoph.update({ tempC });
        ezoph.status = "Ok";
        ezoph.error = "";
      } catch (e) {
        ezoph.status = "failed";
        ezoph.error = safeErrorMessage(e);
        console.error("pH update failed:", ezoph.error);
      }

      // 3) EC (temp-comp if your device uses it)
      try {
        await ezoec.update({ tempC });
        if (!ezoec.status) ezoec.status = "Ok";
        if (!ezoec.error) ezoec.error = "";
      } catch (e) {
        ezoec.status = "failed";
        ezoec.error = safeErrorMessage(e);
        console.error("EC update failed:", ezoec.error);
      }

      // 4) Thermostat measurements
      try {
        await thermostat.update();
        thermostat.status = "Ok";
        thermostat.error = "";
      } catch (e) {
        thermostat.status = "failed";
        thermostat.error = safeErrorMessage(e);
        console.error("Thermostat update failed:", thermostat.error);
      }

      // 5) Pumps
      try {
        await pumpBoard.update();
        pumpBoard.status = "Ok";
        pumpBoard.error = "";
      } catch (e) {
        pumpBoard.status = "failed";
        pumpBoard.error = safeErrorMessage(e);
        console.error("Pump board update failed:", pumpBoard.error);
      }

      // 6) Stirring
      try {
        await stirring.update();
      } catch (e) {
        stirring.status = "failed";
        stirring.error = safeErrorMessage(e);
        console.error("Stirring update failed:", stirring.error);
      }

      // 7) Illumination
      try {
        await illumination.update();
      } catch (e) {
        illumination.status = "failed";
        illumination.error = safeErrorMessage(e);
        console.error("Illumination update failed:", illumination.error);
      }

      // 8) Temp controller tick
      await tempController.tick({ tempC });

      // Snapshot for UI
      const fullSnapshot = buildDevicesSnapshot(
        ezortd,
        ezoph,
        ezoec,
        thermostat,
        pumpBoard,
        stirring,
        illumination
      );

      // Split for storage
      const { dynamic, staticInfo } = splitSnapshotStaticDynamic(fullSnapshot);

      // Logging
      if (processState.running && activeBatchId) {
        try {
          if (staticSavedForBatchId !== activeBatchId) {
            await runDbExclusive(() => saveBatchStatic(db, activeBatchId, staticInfo));
            staticSavedForBatchId = activeBatchId;
          }
          await runDbExclusive(() => logSnapshot(db, activeBatchId, dynamic));
        } catch (e) {
          console.error("DB logging failed:", safeErrorMessage(e));
        }
      }

      broadcast({ type: "devices", data: fullSnapshot });
    } finally {
      polling = false;
    }
  }, POLL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});