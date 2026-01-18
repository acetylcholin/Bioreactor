// src/server/devices/illumination/device.js
import fs from "node:fs/promises";
import path from "node:path";
import { SerialPort } from "serialport";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function safeErrorMessage(e) {
  return (e && e.message) ? e.message : String(e);
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function scaleRgb(rgb, intensityPct) {
  const k = clamp01((Number(intensityPct) || 0) / 100);
  return {
    r: Math.round(rgb.r * k),
    g: Math.round(rgb.g * k),
    b: Math.round(rgb.b * k),
  };
}

async function readFileTrim(p) {
  try { return (await fs.readFile(p, "utf8")).trim(); }
  catch { return ""; }
}

async function listTtyUSB() {
  try {
    const entries = await fs.readdir("/dev");
    return entries.filter(n => n.startsWith("ttyUSB")).map(n => `/dev/${n}`);
  } catch {
    return [];
  }
}

async function findIlluminationPortPath(identity) {
  // allow explicit override
  if (process.env.ILLUMINATION_PORT) return process.env.ILLUMINATION_PORT;

  const ports = await listTtyUSB();

  for (const devnode of ports) {
    const tty = path.basename(devnode);

    const sysTtyDevice = await fs.realpath(`/sys/class/tty/${tty}/device`).catch(() => "");
    if (!sysTtyDevice) continue;

    const usbDev = await fs.realpath(path.join(sysTtyDevice, "..", "..")).catch(() => "");
    if (!usbDev) continue;

    const idVendor  = (await readFileTrim(path.join(usbDev, "idVendor"))).toLowerCase();
    const idProduct = (await readFileTrim(path.join(usbDev, "idProduct"))).toLowerCase();
    const serial    = await readFileTrim(path.join(usbDev, "serial"));

    // minimal match (FTDI VID/PID)
    if (
      idVendor === (identity?.vendorId || "0403").toLowerCase() &&
      idProduct === (identity?.productId || "6001").toLowerCase()
    ) {
      // If sysfs provides a serial AND you configured one, enforce it.
      if (identity?.serial && serial && serial !== identity.serial) continue;
      return devnode;
    }
  }

  return null;
}

export default class IlluminationDevice {
  constructor() {
    this.id = "illumination";
    this.status = "disconnected";
    this.error = "";
    this.updatedAt = Date.now();

    this.identity = {
      vendorId: "0403",
      productId: "6001",
      manufacturer: "jFermi Biotechnology Inc.",
      product: "Illumination module",
      serial: "1234",
    };

    this.portPath = null;
    this.port = null;

    // user-facing settings stored in memory (later can persist)
    this.settings = {
      enabled: false,
      color: "#000000",
      intensity: 100,
    };

    // prevent poll/write collisions
    this._queue = Promise.resolve();
  }

  _runExclusive(fn) {
    this._queue = this._queue.then(fn, fn);
    return this._queue;
  }

  async initialize() {
    return this._runExclusive(async () => {
      try {
        await this._maybeConnect();
        this.status = this.port ? "Ok" : "disconnected";
        this.error = "";

        // apply current settings if connected
        if (this.port) await this._applySettingsToHardware();
      } catch (e) {
        this.status = "failed";
        this.error = safeErrorMessage(e);
      } finally {
        this.updatedAt = Date.now();
      }
    });
  }

  async update() {
    return this._runExclusive(async () => {
      try {
        const found = await findIlluminationPortPath(this.identity);

        if (!found && this.port) {
          await this._disconnect();
          this.portPath = null;
          this.status = "disconnected";
          this.error = "";
        }

        if (found && !this.port) {
          this.portPath = found;
          await this._connect();
          this.status = "Ok";
          this.error = "";
          await this._applySettingsToHardware(); // restore last settings
        }

        if (found && this.port) {
          this.status = "Ok";
          this.error = "";
        }
      } catch (e) {
        this.status = "failed";
        this.error = safeErrorMessage(e);
        try { await this._disconnect(); } catch {}
      } finally {
        this.updatedAt = Date.now();
      }
    });
  }

  async _maybeConnect() {
    const found = await findIlluminationPortPath(this.identity);
    if (!found) return;
    this.portPath = found;
    await this._connect();
  }

  async _connect() {
    if (!this.portPath) throw new Error("Illumination portPath not set");

    this.port = new SerialPort({
      path: this.portPath,
      baudRate: 9600,
      autoOpen: false,
    });

    await new Promise((res, rej) => this.port.open((e) => (e ? rej(e) : res())));
  }

  async _disconnect() {
    if (!this.port) return;
    const p = this.port;
    this.port = null;
    await new Promise((res) => p.close(() => res()));
  }

  async _writeStr(s) {
    if (!this.port) throw new Error("Illumination module not connected");
    await new Promise((res, rej) => this.port.write(s, (e) => (e ? rej(e) : res())));
    await new Promise((res, rej) => this.port.drain((e) => (e ? rej(e) : res())));
  }

  async _applySettingsToHardware() {
    // If disabled → set to black/off
    const enabled = !!this.settings.enabled;
    const color = this.settings.color || "#000000";
    const intensity = clampInt(this.settings.intensity, 0, 100);

    const base = hexToRgb(color);
    const out = enabled ? scaleRgb(base, intensity) : { r: 0, g: 0, b: 0 };

    // protocol: "<r>R", "<g>G", "<b>B"
    await this._writeStr(`${out.r}R`);
    await delay(50);
    await this._writeStr(`${out.g}G`);
    await delay(50);
    await this._writeStr(`${out.b}B`);
  }

  async setPower(enabled) {
    return this._runExclusive(async () => {
      this.settings.enabled = !!enabled;
      if (this.port) await this._applySettingsToHardware();
      this.updatedAt = Date.now();
    });
  }

  async setSettings(next = {}) {
    return this._runExclusive(async () => {
      if (typeof next.enabled === "boolean") this.settings.enabled = next.enabled;
      if (typeof next.color === "string") this.settings.color = next.color;
      if (next.intensity !== undefined) this.settings.intensity = clampInt(next.intensity, 0, 100);

      if (this.port) await this._applySettingsToHardware();
      this.updatedAt = Date.now();
    });
  }

  // backward compatible: setRGB just sets color and enables output
  async setRGB(hex) {
    return this.setSettings({ enabled: true, color: hex });
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      error: this.error || "",
      updatedAt: this.updatedAt,
      identity: this.identity,
      portPath: this.portPath,
      settings: this.settings,
    };
  }
}
