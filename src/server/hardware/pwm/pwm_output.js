// src/server/hardware/pwm/pwm_output.js
import { getPigpioGpio } from "./pigpio_client.js";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export default class PwmOutput {
  constructor(pinBcm, frequencyHz = 250) {
    this.pinBcm = Number.parseInt(pinBcm, 10);
    this.frequencyHz = Math.round(Number(frequencyHz) || 250);

    this.pin = getPigpioGpio(this.pinBcm);

    // pigpio-client: modeSet expects STRING
    this.pin.modeSet("output");

    // Default off
    this.setPercent(0);
  }

  setPercent(percent) {
    const pct = clamp(Number(percent) || 0, 0, 100);

    // pigpio-client hardware PWM: duty is 0..1,000,000
    const duty1e6 = Math.round((pct / 100) * 1_000_000);

    // For GPIO 12/13/18/19 only (hardware PWM capable)
    // Method name in pigpio-client is hardwarePWM (NOT hardwarePwmWrite)
    if (typeof this.pin.hardwarePWM === "function") {
      this.pin.hardwarePWM(this.frequencyHz, duty1e6);
      return;
    }

    // Fallback to software PWM (0..255)
    if (typeof this.pin.analogWrite === "function") {
      const duty255 = Math.round((pct / 100) * 255);
      this.pin.analogWrite(duty255);
      return;
    }

    throw new Error("No PWM method available on this pigpio-client GPIO object");
  }
}



