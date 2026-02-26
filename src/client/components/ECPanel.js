import { openEcConfigDialog } from "../dialogs/EcConfigDialog.js";

export function ECPanel() {
  const tile = document.createElement("div");
  tile.className = "tile";

  tile.innerHTML = `
    <div class="tileHeader">
      <div class="tileTitle">
        <h2>Electrical Conductivity</h2>
        <p>Atlas EZO EC (I²C)</p>
      </div>
      <div class="tileIcon">⚡</div>
    </div>

    <div class="tileBody">
      <div class="tileValue">
        <span class="num" id="ec_value">—</span>
        <span class="unit" id="ec_unit">µS/cm</span>
      </div>
    </div>

    <div class="tileMeta">
      <span class="pill" id="ec_status">—</span>
      <span class="pill">Cal: <span class="mono" id="ec_cal">—</span></span>
    </div>

    <div class="tileFooter">
      <span class="mono" id="ec_time">—</span>
      <button class="tileButton">Configure</button>
    </div>
  `;

  const btn = tile.querySelector("button");
  btn.addEventListener("click", openEcConfigDialog);

  document.addEventListener("onupdatedevices", (e) => {
    const ec = e.detail.ezoecSensor;
    if (!ec) return;

    tile.querySelector("#ec_value").textContent =
      ec.value != null ? ec.value : "—";

    tile.querySelector("#ec_unit").textContent = ec.unit || "µS/cm";

    const status = ec.status || "—";
    const pill = tile.querySelector("#ec_status");
    pill.textContent = status;
    pill.className =
      status.toLowerCase() === "ok" ? "pill ok" : "pill bad";

    tile.querySelector("#ec_cal").textContent =
      ec.calibrationStatus || "—";

    tile.querySelector("#ec_time").textContent =
      ec.updatedAt ? new Date(ec.updatedAt).toLocaleTimeString() : "—";
  });

  return tile;
}