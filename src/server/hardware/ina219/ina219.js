import i2c from "i2c-bus";

function parseHexAddr(addr) {
  if (typeof addr === "number") return addr;
  if (typeof addr === "string" && addr.startsWith("0x")) return parseInt(addr, 16);
  return Number(addr);
}

export default class INA219 {
  constructor({
    bus = "/dev/i2c-1",
    address = "0x40",
    shuntOhms = 0.01,

    // Optional tuning (safe defaults)
    busRange = 32,          // 16 or 32 (V)
    shuntRangeMv = 320,     // 40, 80, 160, 320 (mV)
    adcAveraging = 128,     // 1,2,4,8,16,32,64,128
    mode = "cont"           // "cont" (continuous shunt+bus)
  } = {}) {
    this.busPath = bus;
    this.address = parseHexAddr(address);
    this.shuntOhms = shuntOhms;

    this.busRange = busRange;
    this.shuntRangeMv = shuntRangeMv;
    this.adcAveraging = adcAveraging;
    this.mode = mode;

    this.bus = null;
    this._openPromise = null;
    this._configured = false;
  }

  async open() {
    if (this.bus) return;

    if (!this._openPromise) {
      const busNumber = Number(this.busPath.split("-").pop());
      this._openPromise = i2c.openPromisified(busNumber).then((b) => {
        this.bus = b;
        return b;
      });
    }

    await this._openPromise;

    if (!this._configured) {
      await this.configure();
      this._configured = true;
    }
  }

  async readRegister16(reg) {
    if (!this.bus) await this.open();
    const buf = Buffer.alloc(2);
    await this.bus.readI2cBlock(this.address, reg, 2, buf);
    return (buf[0] << 8) | buf[1];
  }

  async writeRegister16(reg, value) {
    if (!this.bus) await this.open();
    const buf = Buffer.from([(value >> 8) & 0xff, value & 0xff]);
    await this.bus.writeI2cBlock(this.address, reg, 2, buf);
  }

  _busRangeBits() {
    // BRNG bit: 0=16V, 1=32V
    return this.busRange >= 32 ? 1 : 0;
  }

  _pgBits() {
    // PG bits (shunt voltage range)
    // 0: ±40mV, 1: ±80mV, 2: ±160mV, 3: ±320mV
    const mv = this.shuntRangeMv;
    if (mv <= 40) return 0;
    if (mv <= 80) return 1;
    if (mv <= 160) return 2;
    return 3;
  }

  _adcBits() {
    // INA219 ADC field mapping commonly used:
    // 0x9: 12-bit 1 sample
    // 0xA: 12-bit 2 samples
    // 0xB: 12-bit 4 samples
    // 0xC: 12-bit 8 samples
    // 0xD: 12-bit 16 samples
    // 0xE: 12-bit 32 samples
    // 0xF: 12-bit 64/128 samples (most INA219 docs: 0xF = 12-bit 128 samples)
    //
    // In practice, 0xF is the “most averaged” setting and is the stability win.
    const avg = this.adcAveraging;
    if (avg <= 1) return 0x9;
    if (avg <= 2) return 0xA;
    if (avg <= 4) return 0xB;
    if (avg <= 8) return 0xC;
    if (avg <= 16) return 0xD;
    if (avg <= 32) return 0xE;
    return 0xF; // 64/128 (max smoothing)
  }

  _modeBits() {
    // MODE bits:
    // 0x7 = continuous shunt and bus
    return 0x7;
  }

  async configure() {
    const brng = this._busRangeBits(); // 0/1
    const pg = this._pgBits();         // 0..3
    const adc = this._adcBits();       // 0x9..0xF
    const mode = this._modeBits();     // 0x7

    // Config register layout:
    // [15] reset
    // [14:13] BRNG
    // [12:11] PG
    // [10:7] BADC
    // [6:3] SADC
    // [2:0] MODE
    const config =
      (brng << 13) |
      (pg << 11) |
      (adc << 7) |
      (adc << 3) |
      mode;

    await this.writeRegister16(0x00, config);
  }

  async readBusVoltageV() {
    const raw = await this.readRegister16(0x02);
    return ((raw >> 3) & 0x1fff) * 0.004; // 4mV LSB
  }

  async readShuntVoltageV() {
    let raw = await this.readRegister16(0x01);
    if (raw & 0x8000) raw -= 0x10000;
    return raw * 0.00001; // 10uV LSB
  }

  async readCurrentA() {
    const vShunt = await this.readShuntVoltageV();
    return vShunt / this.shuntOhms;
  }

  async close() {
    if (this.bus) {
      await this.bus.close();
      this.bus = null;
      this._openPromise = null;
      this._configured = false;
    }
  }
}
