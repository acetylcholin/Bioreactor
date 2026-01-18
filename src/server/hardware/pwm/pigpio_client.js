// src/server/hardware/pwm/pigpio_client.js
import { pigpio as createPigpioClient } from "pigpio-client";

const HOSTS = [
  process.env.PIGPIO_HOST,
  "::1",          // matches your current pigpiod listen socket
  "127.0.0.1",
].filter(Boolean);

const PORT = process.env.PIGPIO_PORT ? Number(process.env.PIGPIO_PORT) : 8888;

let client = null;

function attachErrorHandler(c) {
  if (c && c.on) {
    c.on("error", (e) => {
      console.error("pigpio-client error:", (e && e.message) ? e.message : String(e));
    });
  }
}

export function getPigpioClient() {
  if (client) return client;

  // Create client using first host; pigpio-client doesn't always support multiple,
  // but this at least fixes your current ::1-only daemon immediately.
  client = createPigpioClient({ host: HOSTS[0], port: PORT });
  attachErrorHandler(client);

  return client;
}

export function getPigpioGpio(pinBcm) {
  const pin = Number.parseInt(pinBcm, 10);
  if (!Number.isFinite(pin) || pin < 0 || pin > 31) {
    throw new Error(`Invalid BCM GPIO pin: ${pinBcm} (pigpio expects 0..31 BCM)`);
  }
  return getPigpioClient().gpio(pin);
}




