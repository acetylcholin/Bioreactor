// src/server/hardware/pwm/pigpio_client.js
import { pigpio as createPigpioClient } from "pigpio-client";

const DEFAULT_HOST = process.env.PIGPIO_HOST || "127.0.0.1";
const DEFAULT_PORT = process.env.PIGPIO_PORT ? Number(process.env.PIGPIO_PORT) : 8888;

let client = null;

export function getPigpioClient() {
  if (client) return client;

  client = createPigpioClient({ host: DEFAULT_HOST, port: DEFAULT_PORT });

  // Prevent "Unhandled 'error' event" crash
  if (client && client.on) {
    client.on("error", (e) => {
      console.error("pigpio-client error:", (e && e.message) ? e.message : String(e));
    });
  }

  return client;
}

export function getPigpioGpio(pinBcm) {
  const pin = Number.parseInt(pinBcm, 10);
  if (!Number.isFinite(pin) || pin < 0 || pin > 31) {
    throw new Error(`Invalid BCM GPIO pin: ${pinBcm} (pigpio expects 0..31 BCM)`);
  }
  return getPigpioClient().gpio(pin);
}



