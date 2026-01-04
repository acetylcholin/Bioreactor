import { pigpio } from "pigpio-client";

let pi = null;

export function getPigpioClient() {
  if (pi) return pi;

  // retry timeout prevents unhandled error from killing the process
  pi = pigpio({
    host: "127.0.0.1",
    port: 8888,
    // keep retrying if daemon restarts
    timeout: 2,
  });

  // prevent unhandled 'error' event from crashing node
  pi.on("error", (e) => {
    console.error("pigpio-client error:", e?.message || e);
  });

  return pi;
}
