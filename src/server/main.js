// src/server/main.js
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

import EzortdDevice from "./devices/temperature/ezo_rtd/device.js";
import EzophDevice from "./devices/ph/ezo_ph/device.js";
import ThermostatDevice from "./devices/thermostat/device.js";
import ParallaxPumpBoard from "./devices/pumps/parallax/device.js";
import StirringDevice from "./devices/stirring/device.js";
import IlluminationDevice from "./devices/illumination/device.js";

// DB
import { initDb } from "./db/db.js";
import { ensureBatch, saveBatchSettings, startBatch, stopBatch, logSnapshot } from "./db/process_store.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const POLL_MS = process.env.POLL_MS ? Number(process.env.POLL_MS) : 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, "../client");

// ---- Fermentation process state (in-memory mirror; DB is source of truth later)
const processState = {
  running: false,
  t0: null,
  settings: {
    batchNumber: "",
    operator: "",
    notes: "",

    targetTempC: "",
    targetPh: "",
    phDeadband: "0.05",
    feedMlh: "",

    targetDoPct: "",
    airFlowMlMin: "",
  },
};

// -------- Helpers
function safeErrorMessage(e) {
  return (e && e.message) ? e.message : String(e);
}

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Build a snapshot that never crashes if a device is missing/failed
function buildDevicesSnapshot(ezortd, ezoph, thermostat, pumpBoard, stirring, illumination) {
  const devices = {};

  // --- RTD
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

  // --- pH
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

  // --- Thermostat
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

  // --- Pumps board
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

  // --- Stirring
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

  // --- Illumination
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

  // ---- Attach process state
  devices.process = {
    running: processState.running,
    t0: processState.t0,
    settings: processState.settings,
  };

  return devices;
}

async function main() {
  // ---- DB init
  const db = await initDb();

  let activeBatchId = null;

  // ---- Devices
  const ezortd = new EzortdDevice();
  const ezoph = new EzophDevice();
  const thermostat = new ThermostatDevice();
  const pumpBoard = new ParallaxPumpBoard();
  const stirring = new StirringDevice({ gpioPin: 19 });
  const illumination = new IlluminationDevice();

  // ---- Init devices independently
  try { await ezortd.initialize(); } catch (e) { ezortd.status = "failed"; ezortd.error = safeErrorMessage(e); console.error("RTD init failed:", ezortd.error); }
  try { await ezoph.initialize(); } catch (e) { ezoph.status = "failed"; ezoph.error = safeErrorMessage(e); console.error("pH init failed:", ezoph.error); }
  try { await thermostat.initialize(); } catch (e) { thermostat.status = "failed"; thermostat.error = safeErrorMessage(e); console.error("Thermostat init failed:", thermostat.error); }
  try { await pumpBoard.initialize(); } catch (e) { pumpBoard.status = "failed"; pumpBoard.error = safeErrorMessage(e); console.error("Pump board init failed:", pumpBoard.error); }
  try { await stirring.initialize(); } catch (e) { stirring.status = "failed"; stirring.error = safeErrorMessage(e); console.error("Stirring init failed:", stirring.error); }
  try { await illumination.initialize(); } catch (e) { illumination.status = "failed"; illumination.error = safeErrorMessage(e); console.error("Illumination init failed:", illumination.error); }

  // ---- Web server
  const app = express();
  app.use(express.json());
  app.use(express.static(CLIENT_DIR));

  app.get("/", (req, res) => {
    res.sendFile(path.join(CLIENT_DIR, "index.html"));
  });

  // ---- Process APIs (DB-backed)
  app.post("/api/process/settings", async (req, res) => {
    try {
      const s = req.body || {};
      const batchNumber = (s.batchNumber || "").trim();
      if (!batchNumber) throw new Error("batchNumber is required");

      const batch = await ensureBatch(db, batchNumber, s.operator || "", s.notes || "");
      activeBatchId = batch.id;

      processState.settings = { ...processState.settings, ...s };
      await saveBatchSettings(db, batch.id, processState.settings);

      res.json({ ok: true, batchId: batch.id });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/process/inoculate", async (req, res) => {
    try {
      const batchNumber = (processState.settings.batchNumber || "").trim();
      if (!batchNumber) throw new Error("Set batchNumber first, then Save.");

      const batch = await ensureBatch(
        db,
        batchNumber,
        processState.settings.operator || "",
        processState.settings.notes || ""
      );
      activeBatchId = batch.id;

      const t0 = await startBatch(db, batch.id);
      processState.running = true;
      processState.t0 = t0;

      res.json({ ok: true, t0 });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.post("/api/process/stop", async (req, res) => {
    try {
      if (!activeBatchId) throw new Error("No active batch. Save settings with a batchNumber first.");
      await stopBatch(db, activeBatchId);
      processState.running = false;
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // ---- Templates
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
      const rows = await db.all(`SELECT id, name, createdAt FROM templates ORDER BY createdAt DESC`);
      res.json({ ok: true, templates: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  app.get("/api/templates/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = await db.get(`SELECT id, name, createdAt, settingsJson FROM templates WHERE id = ?`, [id]);
      if (!row) throw new Error("Template not found");
      res.json({ ok: true, template: { ...row, settings: JSON.parse(row.settingsJson) } });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // ---- Thermostat
  app.post("/api/thermostat/percentage", (req, res) => {
    try { thermostat.setPercentage(req.body.percentage); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.post("/api/thermostat/mode", (req, res) => {
    try { thermostat.setMode(req.body.mode); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  // ---- Stirring
  app.post("/api/stirring/rpm", async (req, res) => {
    try { await stirring.setRPM(req.body.rpm); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  // ---- Pumps
  app.post("/api/pumps/:type/rpm", async (req, res) => {
    try { await pumpBoard.setRPM(req.params.type, req.body.rpm); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.post("/api/pumps/:type/mlh", async (req, res) => {
    try { await pumpBoard.setMLH(req.params.type, req.body.mlh); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.post("/api/pumps/:type/calibrate", async (req, res) => {
    try { await pumpBoard.calibrate(req.params.type, req.body.rpm, req.body.mlh); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.post("/api/pumps/:type/clearsum", (req, res) => {
    try { pumpBoard.clearSum(req.params.type); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  // ---- pH
  app.post("/api/ph/clear", async (req, res) => {
    try { await ezoph.clearCalibration(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.post("/api/ph/calibrate", async (req, res) => {
    try { await ezoph.calibrate(req.body.point, req.body.value); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  // ---- Temp calibration
  app.post("/api/temp/calibrate", async (req, res) => {
    try { await ezortd.calibrate(req.body?.tempC); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.post("/api/temp/clear", async (req, res) => {
    try { await ezortd.clearCalibration(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.get("/api/temp/calstatus", async (req, res) => {
    try { const status = await ezortd.refreshCalibrationStatus(); res.json({ ok: true, status }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  // ---- Illumination
  app.post("/api/illumination/rgb", async (req, res) => {
    try { await illumination.setRGB(req.body?.rgb); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.post("/api/illumination/power", async (req, res) => {
    try { await illumination.setPower(!!req.body?.enabled); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  app.post("/api/illumination/settings", async (req, res) => {
    try { await illumination.setSettings(req.body || {}); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: safeErrorMessage(e) }); }
  });

  // ---- HTTP + WS
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  function broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({
      type: "devices",
      data: buildDevicesSnapshot(ezortd, ezoph, thermostat, pumpBoard, stirring, illumination),
    }));
  });

  server.listen(PORT, () => {
    console.log(`Web UI: http://<raspberrypi-ip>:${PORT}`);
    console.log(`Serving client from: ${CLIENT_DIR}`);
    console.log(`Poll interval: ${POLL_MS} ms`);
  });

  // ---- Poll loop (NON-overlapping)
  let polling = false;

  setInterval(async () => {
    if (polling) return;
    polling = true;

    try {
      // 1) RTD
      try { await ezortd.update(); ezortd.status = "Ok"; ezortd.error = ""; }
      catch (e) { ezortd.status = "failed"; ezortd.error = safeErrorMessage(e); console.error("RTD update failed:", ezortd.error); }

      const tempC = toNumberOrNull(ezortd.value);

      // 2) pH
      try { await ezoph.update({ tempC }); ezoph.status = "Ok"; ezoph.error = ""; }
      catch (e) { ezoph.status = "failed"; ezoph.error = safeErrorMessage(e); console.error("pH update failed:", ezoph.error); }

      // 3) thermostat
      try { await thermostat.update(); thermostat.status = "Ok"; thermostat.error = ""; }
      catch (e) { thermostat.status = "failed"; thermostat.error = safeErrorMessage(e); console.error("Thermostat update failed:", thermostat.error); }

      // 4) pumps
      try { await pumpBoard.update(); pumpBoard.status = "Ok"; pumpBoard.error = ""; }
      catch (e) { pumpBoard.status = "failed"; pumpBoard.error = safeErrorMessage(e); console.error("Pump board update failed:", pumpBoard.error); }

      // 5) stirring
      try { await stirring.update(); }
      catch (e) { stirring.status = "failed"; stirring.error = safeErrorMessage(e); console.error("Stirring update failed:", stirring.error); }

      // 6) illumination
      try { await illumination.update(); }
      catch (e) { illumination.status = "failed"; illumination.error = safeErrorMessage(e); console.error("Illumination update failed:", illumination.error); }

      // Build snapshot
      const snapshot = buildDevicesSnapshot(ezortd, ezoph, thermostat, pumpBoard, stirring, illumination);

      // Log to DB only while RUNNING
      if (processState.running && activeBatchId) {
        try {
          await logSnapshot(db, activeBatchId, snapshot);
        } catch (e) {
          console.error("DB logSnapshot failed:", safeErrorMessage(e));
        }
      }

      // Broadcast to clients
      broadcast({ type: "devices", data: snapshot });

    } finally {
      polling = false;
    }
  }, POLL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
