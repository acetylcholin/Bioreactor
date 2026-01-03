import EZO_I2C from "../../../hardware/ezo/ezo_i2c.js";

export default class EzortdDevice {
  constructor() {
    this.id = "ezortdSensor";
    this.status = "Init";
    this.value = null;

    this.ezo = new EZO_I2C();
  }

  async initialize() {
    await this.ezo.open("/dev/i2c-1", 0x66);
    this.status = "Ok";
  }

  async update() {
    const value = await this.ezo.command("R");
    this.value = Number.parseFloat(value).toFixed(2);
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      value: this.value,
      unit: "°C",
      updatedAt: Date.now()
    };
  }
}
