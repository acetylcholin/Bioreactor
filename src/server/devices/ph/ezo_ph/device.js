import EZO_I2C from "../../../hardware/ezo/ezo_i2c.js";

export default class EzophDevice {
  constructor() {
    this.id = "ezophSensor";
    this.status = "Init";
    this.value = null;

    this.deviceInfo = "";
    this.calibrationStatus = "";
    this.slope = "";
    this.internalTemperature = "N/A";

    // last temperature used for compensation
    this.compTempC = null;

    // optional: server/UI can show it
    this.error = "";

    // ---- NEW: serialize all I2C operations on this device
    this._queue = Promise.resolve();

    this.updatedAt = 0;

    this.ezo = new EZO_I2C();
  }

  // serialize access so poll loop and API calls never overlap
  _runExclusive(fn) {
    this._queue = this._queue.then(fn, fn);
    return this._queue;
  }

  async initialize() {
    return this._runExclusive(async () => {
      try {
        await this.ezo.open("/dev/i2c-1", 0x63); // Atlas EZO pH default I2C address
        this.deviceInfo = await this.ezo.command("i");
        this.calibrationStatus = await this.ezo.command("Cal,?");
        this.slope = await this.ezo.command("Slope,?");
        this.status = "Ok";
        this.error = "";
        this.updatedAt = Date.now();
      } catch (e) {
        this.status = "failed";
        this.error = (e && e.message) ? e.message : String(e);
        this.updatedAt = Date.now();
        throw e;
      }
    });
  }

  /**
   * Update pH reading.
   * Preferred new style:
   *   update({ tempC })
   * Legacy compatibility:
   *   update({ devices: snapshot })
   */
  async update(ctx = {}) {
    return this._runExclusive(async () => {
      let T = 25;

      // preferred
      if (ctx && ctx.tempC != null) {
        const n = Number(ctx.tempC);
        if (Number.isFinite(n)) T = n;
      }

      // legacy support
      if (ctx && ctx.devices) {
        const t2 = ctx.devices?.ezortdSensor?.value;
        const t1 = ctx.devices?.temperatureSensor?.value;
        if (t2 != null) T = Number(t2);
        else if (t1 != null) T = Number(t1);
      }

      try {
        const reading = await this.ezo.command(`RT,${T}`);
        this.value = Number.parseFloat(reading).toFixed(2);
        this.compTempC = T;
        this.status = "Ok";
        this.error = "";
        this.updatedAt = Date.now();
      } catch (e) {
        this.status = "failed";
        this.error = (e && e.message) ? e.message : String(e);
        this.updatedAt = Date.now();
        throw e;
      }
    });
  }

  async calibrate(point, value) {
    return this._runExclusive(async () => {
      const p = String(point || "").toLowerCase();
      const v = Number(value);

      if (!["low", "mid", "high"].includes(p)) {
        throw new Error("Invalid calibration point (use low|mid|high)");
      }
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error("Invalid calibration value");
      }

      await this.ezo.command(`Cal,${p},${v.toFixed(2)}`);
      this.calibrationStatus = await this.ezo.command("Cal,?");
      this.slope = await this.ezo.command("Slope,?");
      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  async clearCalibration() {
    return this._runExclusive(async () => {
      await this.ezo.command("Cal,clear");
      this.calibrationStatus = await this.ezo.command("Cal,?");
      this.slope = await this.ezo.command("Slope,?");
      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      value: this.value,
      unit: "pH",

      calibrationStatus: this.calibrationStatus,
      slope: this.slope,
      internalTemperature: this.internalTemperature,

      // show temp compensation used
      compTempC: this.compTempC,

      // show last error (if any)
      error: this.error,

      updatedAt: this.updatedAt || Date.now(),
    };
  }
}
