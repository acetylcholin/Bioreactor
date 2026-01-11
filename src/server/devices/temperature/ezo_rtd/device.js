import EZO_I2C from "../../../hardware/ezo/ezo_i2c.js";

export default class EzortdDevice {
  constructor() {
    this.id = "ezortdSensor";
    this.status = "Init";
    this.value = null;

    this.error = "";
    this.updatedAt = 0;

    // Raw response from Cal,? (e.g. "?Cal,1" or "?Cal,0")
    this.calibrationStatus = "";

    // serialize I2C access for this device
    this._queue = Promise.resolve();

    this.ezo = new EZO_I2C();
  }

  _runExclusive(fn) {
    this._queue = this._queue.then(fn, fn);
    return this._queue;
  }

  // Internal helper: DO NOT call _runExclusive here (prevents deadlocks)
  async _refreshCalibrationStatusNoLock() {
    const resp = await this.ezo.command("Cal,?");
    this.calibrationStatus = resp;
    return resp;
  }

  // Public: safe to call from outside
  async refreshCalibrationStatus() {
    return this._runExclusive(async () => {
      return this._refreshCalibrationStatusNoLock();
    });
  }

  async initialize() {
    return this._runExclusive(async () => {
      try {
        await this.ezo.open("/dev/i2c-1", 0x66); // EZO RTD default
        await this._refreshCalibrationStatusNoLock(); // <-- internal, no deadlock
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

  async update() {
    return this._runExclusive(async () => {
      try {
        const value = await this.ezo.command("R");
        this.value = Number.parseFloat(value).toFixed(2);
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

  async calibrate(knownTempC) {
    return this._runExclusive(async () => {
      const t = Number(knownTempC);
      if (!Number.isFinite(t)) throw new Error("Invalid temperature value");

      await this.ezo.command(`Cal,${t.toFixed(2)}`);
      await this._refreshCalibrationStatusNoLock();

      this.status = "Ok";
      this.error = "";
      this.updatedAt = Date.now();
    });
  }

  async clearCalibration() {
    return this._runExclusive(async () => {
      await this.ezo.command("Cal,clear");
      await this._refreshCalibrationStatusNoLock();

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
      unit: "°C",
      calibrationStatus: this.calibrationStatus,
      error: this.error,
      updatedAt: this.updatedAt || Date.now(),
    };
  }
}

