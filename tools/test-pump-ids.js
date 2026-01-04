import i2c from "i2c-bus";

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function cmd(bus, addr, s) {
  const tx = Buffer.from(s + "\0", "ascii");
  await bus.i2cWrite(addr, tx.length, tx);
  await sleep(120);
  const rx = Buffer.alloc(100);
  const { bytesRead } = await bus.i2cRead(addr, rx.length, rx);
  const data = rx.slice(0, bytesRead);
  const filtered = [];
  for (const b of data) if (b !== 0) filtered.push(b);
  return Buffer.from(filtered).toString("ascii").trim();
}

const addr = 0x10;
const bus = await i2c.openPromisified(1);

console.log("GetInfo:", await cmd(bus, addr, "GetInfo"));

for (const id of [0,1,2,3,4]) {
  try {
    const r = await cmd(bus, addr, `SetRPM${id} 0`);
    console.log(`SetRPM${id} OK ->`, r || "(ok)");
  } catch (e) {
    console.log(`SetRPM${id} FAIL ->`, e.message || e);
  }
}

await bus.close();
