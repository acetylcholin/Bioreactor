import { openTemperatureConfigDialog } from "../dialogs/TemperatureConfigDialog.js";

export function TemperatureCard() {
  const el = document.createElement("section");
  el.className = "card";

  el.innerHTML = `
    <div class="cardHeader">
      <h2 class="cardTitle">Temperature (EZO RTD)</h2>
      <button class="button" id="btnConfig">Configure</button>
    </div>

    <div class="row">
      <div class="label">Device ID</div>
      <div id="rtd_id" class="value">—</div>
    </div>

    <div class="row">
      <div class="label">Status</div>
      <div id="rtd_status" class="value">—</div>
    </div>

    <div class="big">
      <div id="rtd_value" class="bigValue">—</div>
      <div class="unit">°C</div>
    </div>

    <div id="rtd_time" class="small">—</div>
    <div id="rtd_error" class="error"></div>
  `;

  el.querySelector("#btnConfig").addEventListener("click", () => {
    openTemperatureConfigDialog();
  });

  // Update from the same FullJS-style event name
  document.addEventListener("onupdatedevices", (event) => {
    const rtd = event.detail?.ezortdSensor;

    el.querySelector("#rtd_id").textContent = rtd?.id ?? "—";
    el.querySelector("#rtd_status").textContent = rtd?.status ?? "—";
    el.querySelector("#rtd_value").textContent = rtd?.value ?? "—";

    const ts = rtd?.updatedAt ? new Date(rtd.updatedAt) : null;
    el.querySelector("#rtd_time").textContent =
      ts ? `Updated: ${ts.toLocaleString()}` : "—";

    el.querySelector("#rtd_error").textContent = rtd?.error ?? "";
  });

  return el;
}
