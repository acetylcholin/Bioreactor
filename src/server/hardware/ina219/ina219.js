import i2c from "i2c-bus";

function parseHexAddr(addr) {
  if (typeof addr === "number") return addr;
  if (typeof addr === "string" && addr.startsWith("0x")) return parseInt(addr, 16);
  return Number(addr);
}

export default class INA219 {
  constructor({ bus = "/dev/i2c-1", address = "0x40", shuntOhms = 0.1 }) {
    this.busPath = bus;
    this.address = parseHexAddr(address);
    this.shuntOhms = shuntOhms;
    this.bus = null;
  }

  async open() {
    const busNumber = Number(this.busPath.split("-").pop()); // "/dev/i2c-1" -> 1
    this.bus = await i2c.openPromisified(busNumber);
  }

  async readRegister16(reg) {
    // INA219 registers are big-endian
    const buf = Buffer.alloc(2);
    await this.bus.readI2cBlock(this.address, reg, 2, buf);
    return (buf[0] << 8) | buf[1];
  }

  async readBusVoltageV() {
    // Bus Voltage register 0x02
    const raw = await this.readRegister16(0x02);
    // Bits [15:3] are voltage, LSB = 4mV
    const v = ((raw >> 3) & 0x1FFF) * 0.004;
    return v;
  }

  async readShuntVoltageV() {
    // Shunt Voltage register 0x01 (signed), LSB = 10uV
    let raw = await this.readRegister16(0x01);
    if (raw & 0x8000) raw = raw - 0x10000; // sign extend
    return raw * 0.00001; // 10uV
  }

  async readCurrentA() {
    // Compute current from shunt voltage / shunt resistor
    const vShunt = await this.readShuntVoltageV();
    return vShunt / this.shuntOhms;
  }
}
