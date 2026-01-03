// src/server/main.js
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

import EzortdDevice from "./devices/temperature/ezo_rtd/device.js";
import EzophDevice from "./devices/ph/ezo_ph/device.js";

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
function buildDevicesSnapshot(ezortd, ezoph) {
  const devices = {};

  if (ezortd) {
    try {
      devices.ezortdSensor = ezortd.toJSON();
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

  if (ezoph) {
    try {
      const j = ezoph.toJSON();
      // include error if you store it on the device instance
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

  return devices;
}

async function main() {
  // ---- Devices
  const ezortd = new EzortdDevice();
  const ezoph = new EzophDevice();

  // init devices independently (no crash if one fails)
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

  // ---- Web server
  const app = express();
  app.use(express.static(CLIENT_DIR));
  app.get("/", (req, res) => {
    res.sendFile(path.join(CLIENT_DIR, "index.html"));
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
        data: buildDevicesSnapshot(ezortd, ezoph),
      })
    );
  });

  server.listen(PORT, () => {
    console.log(`Web UI: http://<raspberrypi-ip>:${PORT}`);
    console.log(`Serving client from: ${CLIENT_DIR}`);
    console.log(`Poll interval: ${POLL_MS} ms`);
  });

  // ---- Poll loop (robust)
  setInterval(async () => {
    // 1) Update temperature (don’t let failure stop anything)
    let tempC = null;
    try {
      if (ezortd && ezortd.status !== "failed") {
        await ezortd.update();
      } else if (ezortd) {
        // still try sometimes even if failed (optional: remove if you prefer)
        await ezortd.update();
        ezortd.status = "Ok";
        ezortd.error = "";
      }
    } catch (e) {
      ezortd.status = "failed";
      ezortd.error = safeErrorMessage(e);
      // keep running
      console.error("RTD update failed:", ezortd.error);
    }

    // Get temperature if we have it (for pH compensation)
    try {
      const t = ezortd && ezortd.value != null ? ezortd.value : null;
      tempC = toNumberOrNull(t);
    } catch {
      tempC = null;
    }

    // 2) Update pH (use temperature compensation if available, otherwise plain read)
    try {
      // We want pH to work even without temperature.
      // Pass an options object; device can choose how to use it.
      if (ezoph) {
        await ezoph.update({ tempC }); // tempC can be null
        ezoph.status = "Ok";
        ezoph.error = "";
      }
    } catch (e) {
      ezoph.status = "failed";
      ezoph.error = safeErrorMessage(e);
      console.error("pH update failed:", ezoph.error);
    }

    // 3) Always broadcast (UI never dies)
    broadcast({
      type: "devices",
      data: buildDevicesSnapshot(ezortd, ezoph),
    });
  }, POLL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
