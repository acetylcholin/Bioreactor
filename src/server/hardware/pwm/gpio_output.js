// src/server/hardware/pwm/gpio_output.js
import { getPigpioGpio } from "./pigpio_client.js";

export default class GpioOutput {
  constructor(pinBcm) {
    this.pinBcm = Number.parseInt(pinBcm, 10);
    this.pin = getPigpioGpio(this.pinBcm);

    // pigpio-client: modeSet expects STRING
    this.pin.modeSet("output");
  }

  write(value) {
    const v = Number(value) ? 1 : 0;
    this.pin.write(v);
  }
}




