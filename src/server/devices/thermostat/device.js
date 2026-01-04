import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import INA219 from "../../hardware/ina219/ina219.js";
import PwmOutput from "../../hardware/pwm/pwm_output.js";
import GpioOutput from "../../hardware/pwm/gpio_output.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function safeMsg(e) {
  return (e && e.message) ? e.message : String(e);
}

export default class ThermostatDevice {
  constructor(configPath = path.resolve(__dirname, "../../config/hardware.json")) {
    this.id = "thermostat";

    // state (matches your FullJS concept: percentage + mode + current/power) :contentReference[oaicite:1]{index=1}
    this.status = "Init";
    this.mode = 0;        // 0=cooling, 1=heating
    this.percentage = 0;  // 0..100

    this.voltage = null;  // V
    this.current = null;  // A
    this.power = null;    // W
    this.error = "";

    // read config
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw).thermostat;

    this.pwmGpio = cfg.pwmGpio;
    this.modeGpio = cfg.modeGpio;

    this.ina = new INA219({
      bus: cfg.ina219.i2cBus,
      address: cfg.ina219.address,
      shuntOhms: cfg.ina219.shuntOhms
    });

    this.pwm = null;
    this.modePin = null;
  }

  async initialize() {
    try {
      await this.ina.open();

      this.pwm = new PwmOutput(this.pwmGpio, 250);
      this.modePin = new GpioOutput(this.modeGpio);

      // apply defaults
      this.setMode(this.mode);
      this.setPercentage(this.percentage);

      this.status = "Ok";
      this.error = "";
    } catch (e) {
      this.status = "failed";
      this.error = safeMsg(e);
      throw e;
    }
  }

  setMode(mode) {
    const m = Number(mode) === 1 ? 1 : 0;
    this.mode = m;
    if (this.modePin) this.modePin.write(m); // your hardware decides meaning of 0/1
  }

  setPercentage(p) {
    const pct = Math.max(0, Math.min(100, Number(p)));
    this.percentage = pct;
    if (this.pwm) this.pwm.setPercent(pct);
  }

  async update() {
    try {
      const v = await this.ina.readBusVoltageV();
      const a = await this.ina.readCurrentA();

      this.voltage = Number(v.toFixed(2));
      this.current = Number(a.toFixed(3));
      this.power = Number((v * a).toFixed(2));

      this.status = "Ok";
      this.error = "";
    } catch (e) {
      this.status = "failed";
      this.error = safeMsg(e);
      throw e;
    }
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      mode: this.mode,
      percentage: this.percentage,
      voltage: this.voltage,
      current: this.current,
      power: this.power,
      error: this.error,
      updatedAt: Date.now()
    };
  }
}
