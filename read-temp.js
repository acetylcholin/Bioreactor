import EzortdDevice from "./src/server/devices/temperature/ezo_rtd/device.js";

async function main() {
  const sensor = new EzortdDevice();
  await sensor.initialize();

  console.log("RTD ready:", sensor.id);

  setInterval(async () => {
    try {
      await sensor.update();
      console.log("Temperature:", sensor.value, "°C");
    } catch (e) {
      console.error("Read error:", e.message);
    }
  }, 3000);
}

main().catch(console.error);