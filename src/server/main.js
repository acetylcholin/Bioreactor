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

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const POLL_MS = process.env.POLL_MS ? Number(process.env.POLL_MS) : 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, "../client");

// -------- Helpers
function safeErrorMessage(e) {
  return (e && e.message) ? e.message : String(e);
}

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Build a snapshot that never crashes if a device is missing/failed
function buildDevicesSnapshot(ezortd, ezoph, thermostat, pumpBoard) {
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

  // --- Pumps board (Parallax / 4-channel)
  if (pumpBoard) {
    try {
      devices.pumps = pumpBoard.toJSON();
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

  return devices;
}

async function main() {
  // ---- Devices (create)
  const ezortd = new EzortdDevice();
  const ezoph = new EzophDevice();
  const thermostat = new ThermostatDevice();
  const pumpBoard = new ParallaxPumpBoard();

  // ---- Devices (init independently)
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

  // ---- Web server
  const app = express();
  app.use(express.json());
  app.use(express.static(CLIENT_DIR));

  app.get("/", (req, res) => {
    res.sendFile(path.join(CLIENT_DIR, "index.html"));
  });

  // ---- Thermostat control APIs
  app.post("/api/thermostat/percentage", (req, res) => {
    try {
      thermostat.setPercentage(req.body.percentage);
      res.json({ ok: true });
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

  // ---- Pumps APIs (type = acid|base|antifoam|feed)
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

  const server = http.createServer(app);

  // ---- WebSocket
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
        data: buildDevicesSnapshot(ezortd, ezoph, thermostat, pumpBoard),
      })
    );
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
      // 1) Update RTD
      try {
        await ezortd.update();
        ezortd.status = "Ok";
        ezortd.error = "";
      } catch (e) {
        ezortd.status = "failed";
        ezortd.error = safeErrorMessage(e);
        console.error("RTD update failed:", ezortd.error);
      }

      // Temperature for pH compensation
      const tempC = toNumberOrNull(ezortd.value);

      // 2) Update pH
      try {
        await ezoph.update({ tempC });
        ezoph.status = "Ok";
        ezoph.error = "";
      } catch (e) {
        ezoph.status = "failed";
        ezoph.error = safeErrorMessage(e);
        console.error("pH update failed:", ezoph.error);
      }

      // 3) Update thermostat measurement
      try {
        await thermostat.update();
        thermostat.status = "Ok";
        thermostat.error = "";
      } catch (e) {
        thermostat.status = "failed";
        thermostat.error = safeErrorMessage(e);
        console.error("Thermostat update failed:", thermostat.error);
      }

      // 4) Update pumps board (lightweight)
      try {
        await pumpBoard.update();
        pumpBoard.status = "Ok";
        pumpBoard.error = "";
      } catch (e) {
        pumpBoard.status = "failed";
        pumpBoard.error = safeErrorMessage(e);
        console.error("Pump board update failed:", pumpBoard.error);
      }

      // 5) Broadcast
      broadcast({
        type: "devices",
        data: buildDevicesSnapshot(ezortd, ezoph, thermostat, pumpBoard),
      });
    } finally {
      polling = false;
    }
  }, POLL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
