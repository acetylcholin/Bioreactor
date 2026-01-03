import EZO_I2C from "../../../hardware/ezo/ezo_i2c.js";

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default class EzophDevice {
  constructor() {
    this.id = "ezophSensor";
    this.status = "Init";
    this.value = null;

    this.deviceInfo = "";
    this.calibrationStatus = "";
    this.slope = "";
    this.internalTemperature = "N/A";

    this.lastCompTempC = null; // last temperature used for compensation
    this.error = "";           // optional: server/UI can show it

    this.ezo = new EZO_I2C();
  }

  async initialize() {
    try {
      await this.ezo.open("/dev/i2c-1", 0x63); // Atlas EZO pH default I2C address
      this.deviceInfo = await this.ezo.command("i");
      this.calibrationStatus = await this.ezo.command("Cal,?");
      this.slope = await this.ezo.command("Slope,?");
      this.status = "Ok";
      this.error = "";
    } catch (e) {
      this.status = "failed";
      this.error = (e && e.message) ? e.message : String(e);
      throw e;
    }
  }

  /**
   * Update pH reading.
   * Accepts either:
   *   update({ tempC })  // preferred new style
   * or legacy:
   *   update(devices)    // where devices.ezortdSensor.value exists
   */
  async update(input) {
    // ---- Determine temperature for compensation
    let tempC = null;

    // New style: update({ tempC })
    if (input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "tempC")) {
      tempC = toNumberOrNull(input.tempC);
    } else {
      // Legacy style: update(devices)
      const devices = input;

      const t2 = devices && devices.ezortdSensor && devices.ezortdSensor.value;
      const t1 = devices && devices.temperatureSensor && devices.temperatureSensor.value;

      tempC = toNumberOrNull(t2);
      if (tempC == null) tempC = toNumberOrNull(t1);
    }

    // Fallback if no valid temperature available
    if (tempC == null) tempC = 25;

    this.lastCompTempC = tempC;

    // ---- Read pH with temperature compensation
    try {
      const reading = await this.ezo.command(`RT,${tempC}`);
      const pH = Number.parseFloat(reading);

      this.value = Number.isFinite(pH) ? pH.toFixed(2) : null;
      this.status = "Ok";
      this.error = "";
    } catch (e) {
      this.status = "failed";
      this.error = (e && e.message) ? e.message : String(e);
      throw e;
    }
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

      // helpful debug info (optional for UI)
      compTempC: this.lastCompTempC,
      error: this.error,

      updatedAt: Date.now(),
    };
  }
}
