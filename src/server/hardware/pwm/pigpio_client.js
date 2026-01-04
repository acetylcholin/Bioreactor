import { pigpio } from "pigpio-client";

let pi = null;

export function getPigpioClient() {
  if (pi) return pi;

  pi = pigpio({
    host: "127.0.0.1",
    port: 8888,
    timeout: 2   // retry instead of crash
  });

  // IMPORTANT: swallow errors so Node doesn't crash
  pi.on("error", (e) => {
    console.warn("pigpio-client:", e?.message || e);
  });

  return pi;
}
