import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import i2c from "i2c-bus";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function safeMsg(e) { return (e && e.message) ? e.message : String(e); }

function parseHexAddr(addr) {
  if (typeof addr === "number") return addr;
  if (typeof addr === "string" && addr.startsWith("0x")) return parseInt(addr, 16);
  return Number(addr);
}

export default class ParallaxPumpBoard {
  constructor(configPath = path.resolve(__dirname, "../../../config/hardware.json")) {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8")).pumps;

    this.id = "";
    this.status = "Init";
    this.error = "";

    this.busPath = cfg.i2cBus || "/dev/i2c-1";
    this.address = parseHexAddr(cfg.address || "0x10");
    this.channels = cfg.channels || { acid: 3, base: 0, antifoam: 1, feed: 2 };

    this.bus = null;

    // serialize I2C operations (same idea as FullJS Bottleneck) :contentReference[oaicite:4]{index=4}
    this._q = Promise.resolve();

    // per-channel runtime state
    this.state = {};
    for (const name of Object.keys(this.channels)) {
      this.state[name] = {
        name,
        pumpid: this.channels[name],
        rpm: 0,
        mlh: 0,
        sumML: 0,
        calibrationStatus: "",
        updatedAt: 0,
        error: ""
      };
    }

    // sumML integration every second (FullJS does sumML += mlh/3600) :contentReference[oaicite:5]{index=5}
    setInterval(() => {
      for (const k of Object.keys(this.state)) {
        this.state[k].sumML += (Number(this.state[k].mlh) || 0) / 3600;
      }
    }, 1000);
  }

  async initialize() {
    try {
      const busNumber = Number(this.busPath.split("-").pop()); // /dev/i2c-1 -> 1
      this.bus = await i2c.openPromisified(busNumber);

      this.id = await this.command("GetInfo");

      // init each channel: stop pumps, fetch calibration
      for (const name of Object.keys(this.state)) {
        const pid = this.state[name].pumpid;
        await this.command(`SetRPM${pid} 0`);
        await this.command(`SetMLH${pid} 0`);
        this.state[name].rpm = 0;
        this.state[name].mlh = 0;
        this.state[name].calibrationStatus = await this.command(`GetCal${pid}`);
        this.state[name].updatedAt = Date.now();
      }

      this.status = "Ok";
      this.error = "";
    } catch (e) {
      this.status = "failed";
      this.error = safeMsg(e);
      throw e;
    }
  }

  // queued command
  async command(cmd) {
    this._q = this._q.then(() => this._commandInternal(cmd));
    return this._q;
  }

  async _commandInternal(cmd) {
    if (!this.bus) throw new Error("I2C bus not open");

    const tx = Buffer.from(cmd + "\0", "ascii");
    await this.bus.i2cWrite(this.address, tx.length, tx);

    // FullJS waits ~100ms before reading :contentReference[oaicite:6]{index=6}
    await sleep(120);

    const rx = Buffer.alloc(100);
    const { bytesRead } = await this.bus.i2cRead(this.address, rx.length, rx);
    const data = rx.slice(0, bytesRead);

    // remove zeros
    const filtered = [];
    for (const b of data) if (b !== 0) filtered.push(b);

    if (filtered.length === 0 || filtered[0] === 0) {
      throw new Error("no pending request");
    }
    return Buffer.from(filtered).toString("ascii").trim();
  }

  // ---- Actions (called by REST API)
  async setRPM(type, rpm) {
    const ch = this._get(type);
    const v = Math.max(0, Math.min(50, Number(rpm)));
    await this.command(`SetRPM${ch.pumpid} ${v}`);
    ch.rpm = v;
    ch.updatedAt = Date.now();
  }

  async setMLH(type, mlh) {
    const ch = this._get(type);
    const v = Math.max(0, Math.min(9999, Number(mlh)));
    await this.command(`SetMLH${ch.pumpid} ${v}`);
    ch.mlh = v;
    ch.updatedAt = Date.now();
  }

  async calibrate(type, rpm, mlh) {
    const ch = this._get(type);
    await this.command(`SetCal${ch.pumpid},${Number(rpm)},${Number(mlh)}`);
    ch.calibrationStatus = await this.command(`GetCal${ch.pumpid}`);
    ch.updatedAt = Date.now();
  }

  clearSum(type) {
    const ch = this._get(type);
    ch.sumML = 0;
    ch.updatedAt = Date.now();
  }

  _get(type) {
    const key = String(type || "").toLowerCase();
    if (!this.state[key]) throw new Error(`Unknown pump type: ${type}`);
    return this.state[key];
  }

  async update() {
    // board itself has no periodic read in your FullJS sample; it just stays Ok :contentReference[oaicite:7]{index=7}
    this.status = "Ok";
  }

  toJSON() {
    const pumps = {};
    for (const k of Object.keys(this.state)) {
      const p = this.state[k];
      pumps[k] = {
        id: this.id || "-",
        status: this.status,
        name: p.name,
        pumpid: p.pumpid,
        rpm: p.rpm,
        mlh: p.mlh,
        sumML: Math.round(p.sumML * 10) / 10,
        calibrationStatus: p.calibrationStatus || "",
        updatedAt: p.updatedAt,
        error: p.error || ""
      };
    }
    return {
      id: this.id || "-",
      status: this.status,
      error: this.error,
      address: `0x${this.address.toString(16)}`,
      pumps,
      updatedAt: Date.now()
    };
  }
}
