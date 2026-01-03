import i2c from "i2c-bus";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default class EZO_I2C {
  constructor() {
    this.bus = null;
    this.address = null;
  }

  async open(devicePath, address) {
    const busNumber = Number(devicePath.split("-").pop());
    this.bus = await i2c.openPromisified(busNumber);
    this.address = address;
  }

  async command(cmd) {
    if (!this.bus) throw new Error("I2C bus not open");

    const c = cmd.trim().toUpperCase();
    const isReadCmd = c === "R" || c.startsWith("R,") || c.startsWith("RT");

    // Write command (null-terminated ASCII)
    const tx = Buffer.from(cmd + "\0", "ascii");
    await this.bus.i2cWrite(this.address, tx.length, tx);

    // Give the module time to process.
    // Read/RT commands often need ~900ms+ depending on module/settings.
    await sleep(isReadCmd ? 1100 : 350);

    // Try multiple reads. Atlas returns:
    // 1 = success
    // 254 = still processing
    // 255 = no data to send (often ensure you wait + retry)
    for (let attempt = 0; attempt < 8; attempt++) {
      const rx = Buffer.alloc(32);
      const { bytesRead } = await this.bus.i2cRead(this.address, rx.length, rx);

      const status = rx[0];
      const text = rx
        .slice(1, bytesRead)
        .toString("ascii")
        .replace(/\0/g, "")
        .trim();

      if (status === 1) return text;

      if (status === 254 || status === 255) {
        // wait a bit and try again
        await sleep(150);
        continue;
      }

      throw new Error(`EZO error ${status}: ${text}`);
    }

    throw new Error(
      `EZO error 255/254: no response from device at 0x${this.address
        .toString(16)
        .toUpperCase()} (check i2cdetect, wiring, address, power)`
    );
  }
}
