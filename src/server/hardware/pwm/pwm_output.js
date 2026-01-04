import { getPigpioClient } from "./pigpio_client.js";

export default class PwmOutput {
  constructor(gpio) {
    this.gpio = gpio;
    this.currentDuty = 0;

    const pi = getPigpioClient();
    this.pin = pi.gpio(gpio);
    this.pin.modeSet("output");
  }

  setPercent(percent) {
    const p = Math.max(0, Math.min(100, Number(percent)));
    const duty = Math.round((p / 100) * 255); // 0..255
    this.pin.pwm(duty);   // ✅ CORRECT for pigpio-client
    this.currentDuty = p;
  }
}
