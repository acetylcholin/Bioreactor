import { getPigpioClient } from "./pigpio_client.js";

export default class GpioOutput {
  constructor(gpio) {
    this.gpio = gpio;

    const pi = getPigpioClient();
    this.pin = pi.gpio(gpio);
    this.pin.modeSet("output");

    this.value = 0;
  }

  write(v) {
    const val = v ? 1 : 0;
    this.pin.write(val);
    this.value = val;
  }
}

