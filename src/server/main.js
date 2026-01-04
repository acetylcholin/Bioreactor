// src/server/main.js
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

import EzortdDevice from "./devices/temperature/ezo_rtd/device.js";
import EzophDevice from "./devices/ph/ezo_ph/device.js";
import ThermostatDevice from "./devices/thermostat/device.js";

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
function buildDevicesSnapshot(ezortd, ezoph, thermostat) {
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

  return devices;
}

async function main() {
  // ---- Devices (create)
  const ezortd = new EzortdDevice();
  const ezoph = new EzophDevice();
  const thermostat = new ThermostatDevice();

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

  // ---- Web server
  const app = express();
  app.use(express.json());              // <-- needed for thermostat POST APIs
  app.use(express.static(CLIENT_DIR));

  app.get("/", (req, res) => {
    res.sendFile(path.join(CLIENT_DIR, "index.html"));
  });

  // ---- Thermostat control APIs (like your FullJS remote calls)
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
        data: buildDevicesSnapshot(ezortd, ezoph, thermostat),
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
    if (polling) return;  // prevents overlapping I2C commands
    polling = true;

    try {
      // 1) Update RTD (safe)
      try {
        await ezortd.update();
        ezortd.status = "Ok";
        ezortd.error = "";
      } catch (e) {
        ezortd.status = "failed";
        ezortd.error = safeErrorMessage(e);
        console.error("RTD update failed:", ezortd.error);
      }

      // pick temperature for pH compensation if available
      const tempC = toNumberOrNull(ezortd.value);

      // 2) Update pH (safe; works with or without temp)
      try {
        await ezoph.update({ tempC }); // EzophDevice falls back to 25 if tempC is null
        ezoph.status = "Ok";
        ezoph.error = "";
      } catch (e) {
        ezoph.status = "failed";
        ezoph.error = safeErrorMessage(e);
        console.error("pH update failed:", ezoph.error);
      }

      // 3) Update thermostat measurements (safe)
      try {
        await thermostat.update();
        thermostat.status = "Ok";
        thermostat.error = "";
      } catch (e) {
        thermostat.status = "failed";
        thermostat.error = safeErrorMessage(e);
        console.error("Thermostat update failed:", thermostat.error);
      }

      // 4) Broadcast (always)
      broadcast({
        type: "devices",
        data: buildDevicesSnapshot(ezortd, ezoph, thermostat),
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
