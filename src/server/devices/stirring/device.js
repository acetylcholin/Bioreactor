// src/server/devices/stirring/device.js
import PwmOutput from "../../hardware/pwm/pwm_output.js";

function safeErrorMessage(e) {
  return (e && e.message) ? e.message : String(e);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export default class StirringDevice {
  constructor(opts = {}) {
    this.id = "stirring";
    this.status = "Init";
    this.error = "";

    // BCM pin (physical 35 = BCM 19)  <-- IMPORTANT
    this.gpioPin = Number.parseInt(opts.gpioPin ?? 19, 10);
    if (!Number.isFinite(this.gpioPin) || this.gpioPin < 0 || this.gpioPin > 31) {
      throw new Error(`Invalid stirring BCM gpioPin: ${opts.gpioPin}`);
    }

    this.rpm = 0;
    this.updatedAt = 0;

    this._pwm = null;
    this._queue = Promise.resolve();
  }

  _runExclusive(fn) {
    this._queue = this._queue.then(fn, fn);
    return this._queue;
  }

  async initialize() {
    return this._runExclusive(async () => {
      try {
        // Use the same PWM abstraction as thermostat
        // Frequency here is just a base; your old mapping was RPM->frequency.
        // We'll implement RPM->frequency using the same math as the old software.
        this._pwm = new PwmOutput(this.gpioPin, 1000);

        // stop
        this._pwm.setPercent(0);

        this.status = "Ok";
        this.error = "";
        this.updatedAt = Date.now();
        return true;
      } catch (e) {
        this.status = "failed";
        this.error = safeErrorMessage(e);
        this.updatedAt = Date.now();
        throw e;
      }
    });
  }

  // Your original logic generates a frequency from RPM.
  // With pigpio hardware PWM we can drive frequency directly, but our PwmOutput currently uses fixed freq.
  // So here we recreate the old behavior by re-creating the PWM object at the needed frequency.
  async setRPM(rpm) {
    return this._runExclusive(async () => {
      const n = Number(rpm);
      if (!Number.isFinite(n)) throw new Error("RPM must be a number");
      if (n < 0 || n > 2000) throw new Error("RPM must be between 0..2000");

      this.rpm = Math.round(n);
      this.updatedAt = Date.now();

      try {
        // RPM -> frequency (your old mapping)
        const rps = this.rpm / 60;
        const freq = rps * 1000 * 4; // Hz
        const f = (freq > 0 && Number.isFinite(freq)) ? Math.round(freq) : 0;

        // Rebuild PWM with new frequency (closest to your legacy behavior)
        if (this._pwm) {
          this._pwm.setPercent(0);
        }

        this._pwm = new PwmOutput(this.gpioPin, clamp(f, 1, 200000)); // keep sane
        this._pwm.setPercent(this.rpm === 0 ? 0 : 50); // 50% duty like your old code

        this.status = "Ok";
        this.error = "";
      } catch (e) {
        this.status = "failed";
        this.error = safeErrorMessage(e);
      }
    });
  }

  async update() {
    return this._runExclusive(async () => {
      this.updatedAt = Date.now();
      return true;
    });
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      rpm: this.rpm,
      unit: "RPM",
      gpioPin: this.gpioPin,
      error: this.error,
      updatedAt: this.updatedAt || Date.now(),
    };
  }
}

