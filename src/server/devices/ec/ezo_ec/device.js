// src/server/devices/ec/ezo_ec/device.js
import EzoI2C from "../../../hardware/ezo/ezo_i2c.js";

class EzOecDevice extends EzoI2C {
  constructor() {
    super();

    this.id = "-";
    this.status = "disconnected";
    this.value = null;
    this.unit = "µS/cm";
    this.calibrationStatus = "-";
    this.error = "";
    this.updatedAt = null;
  }

  async initialize() {
    try {
      await this.open("/dev/i2c-1", 0x64); // EC default address
      this.id = await this.command("i");
      this.calibrationStatus = await this.command("Cal,?");
      this.status = "Ok";
    } catch (e) {
      this.status = "failed";
      this.error = e.message;
      throw e;
    }
  }

  async update({ tempC }) {
    try {
      const T = tempC ?? 25;
      await this.command(`T,${T}`);
      this.value = parseFloat(await this.command("R"));
      this.calibrationStatus = await this.command("Cal,?");
      this.updatedAt = Date.now();
      this.status = "Ok";
      this.error = "";
    } catch (e) {
      this.status = "failed";
      this.error = e.message;
    }
  }

  async clearCalibration() {
    await this.command("Cal,clear");
    this.calibrationStatus = await this.command("Cal,?");
  }

  async calibrateDry() {
    await this.command("Cal,dry");
    this.calibrationStatus = await this.command("Cal,?");
  }

  async calibrateLow(v) {
    await this.command(`Cal,low,${v}`);
    this.calibrationStatus = await this.command("Cal,?");
  }

  async calibrateHigh(v) {
    await this.command(`Cal,high,${v}`);
    this.calibrationStatus = await this.command("Cal,?");
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      value: this.value,
      unit: this.unit,
      calibrationStatus: this.calibrationStatus,
      error: this.error,
      updatedAt: this.updatedAt,
    };
  }
}

export default EzOecDevice;