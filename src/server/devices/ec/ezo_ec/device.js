import EZO_I2C from "../../../hardware/ezo/ezo_i2c.js";

export default class EzOecDevice {
  constructor() {
    this.id = "ezoecSensor";
    this.status = "Init";

    this.value = null;
    this.unit = "µS/cm";

    this.deviceInfo = "";
    this.calibrationStatus = "";
    this.compTempC = null;

    this.error = "";
    this.updatedAt = 0;

    // Prevent overlapping I2C operations
    this._queue = Promise.resolve();

    this.ezo = new EZO_I2C();
  }

  // ------------------------------------------------
  // Serialize all device access
  // ------------------------------------------------
  _runExclusive(fn) {
    this._queue = this._queue.then(fn, fn);
    return this._queue;
  }

  // ------------------------------------------------
  // Initialize device
  // ------------------------------------------------
  async initialize() {
    return this._runExclusive(async () => {
      await this.ezo.open("/dev/i2c-1", 0x64); // Atlas EZO EC default

      this.deviceInfo = await this.ezo.command("i");
      this.calibrationStatus = await this.ezo.command("Cal,?");

      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  // ------------------------------------------------
  // Update EC reading
  // ------------------------------------------------
  async update({ tempC } = {}) {
    return this._runExclusive(async () => {

      let T = 25;

      if (tempC != null) {
        const n = Number(tempC);
        if (Number.isFinite(n)) T = n;
      }

      // Temperature compensation
      await this.ezo.command(`T,${T}`);

      const reading = await this.ezo.command("R");

      this.value = Number.parseFloat(reading);

      this.calibrationStatus = await this.ezo.command("Cal,?");

      this.compTempC = T;
      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  // ------------------------------------------------
  // Clear calibration
  // ------------------------------------------------
  async clearCalibration() {
    return this._runExclusive(async () => {

      await this.ezo.command("Cal,clear");

      this.calibrationStatus = await this.ezo.command("Cal,?");

      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  // ------------------------------------------------
  // Dry calibration (must be first)
  // ------------------------------------------------
  async calibrateDry() {
    return this._runExclusive(async () => {

      await this.ezo.command("Cal,dry");

      this.calibrationStatus = await this.ezo.command("Cal,?");

      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  // ------------------------------------------------
  // Single point calibration
  // Atlas syntax: Cal,<value>
  // Example: Cal,500
  // ------------------------------------------------
  async calibrateSingle(value) {
    return this._runExclusive(async () => {

      const v = Number(value);

      if (!Number.isFinite(v) || v <= 0) {
        throw new Error("Invalid EC calibration value");
      }

      await this.ezo.command(`Cal,${v}`);

      this.calibrationStatus = await this.ezo.command("Cal,?");

      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  // ------------------------------------------------
  // Low calibration
  // ------------------------------------------------
  async calibrateLow(value) {
    return this._runExclusive(async () => {

      const v = Number(value);

      if (!Number.isFinite(v) || v <= 0) {
        throw new Error("Invalid EC calibration value");
      }

      await this.ezo.command(`Cal,low,${v}`);

      this.calibrationStatus = await this.ezo.command("Cal,?");

      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  // ------------------------------------------------
  // High calibration
  // ------------------------------------------------
  async calibrateHigh(value) {
    return this._runExclusive(async () => {

      const v = Number(value);

      if (!Number.isFinite(v) || v <= 0) {
        throw new Error("Invalid EC calibration value");
      }

      await this.ezo.command(`Cal,high,${v}`);

      this.calibrationStatus = await this.ezo.command("Cal,?");

      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  // ------------------------------------------------
  // JSON for UI
  // ------------------------------------------------
  toJSON() {
    return {
      id: this.id,
      status: this.status,
      value: this.value,
      unit: this.unit,

      calibrationStatus: this.calibrationStatus,
      compTempC: this.compTempC,

      error: this.error,
      updatedAt: this.updatedAt || Date.now()
    };
  }
}