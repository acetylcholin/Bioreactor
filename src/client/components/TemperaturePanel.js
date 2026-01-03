import { openTemperatureConfigDialog } from "../dialogs/TemperatureConfigDialog.js";

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "ok") return "pill ok";
  if (!s || s === "—") return "pill";
  return "pill bad";
}

export function TemperaturePanel() {
  const el = document.createElement("section");
  el.className = "tile";

  el.innerHTML = `
    <div class="tileHeader">
      <div class="tileTitle">
        <h2>Temperature</h2>
        <p>Atlas EZO RTD • I²C</p>
      </div>

      <div class="tileIcon" title="Temperature">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 17a2 2 0 0 0 0-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    </div>

    <div class="tileBody">
      <div class="tileValue">
        <div class="num" id="rtd_value">—</div>
        <div class="unit">°C</div>
      </div>

      <div class="tileMeta">
        <span class="pill" id="rtd_status">—</span>
      </div>
    </div>

    <div class="tileFooter">
      <div>
        <div>Device</div>
        <div class="mono" id="rtd_id">—</div>
      </div>

      <div style="text-align:right;">
        <div id="rtd_time">—</div>
        <div id="rtd_error" style="color:#ff7b7b; min-height:14px;"></div>
      </div>

      <button class="tileButton" id="btnConfig">Configure</button>
    </div>
  `;

  el.querySelector("#btnConfig").addEventListener("click", () => {
    openTemperatureConfigDialog();
  });

  document.addEventListener("onupdatedevices", (event) => {
    const devices = event.detail || {};
    const rtd = devices.ezortdSensor || null;

    el.querySelector("#rtd_id").textContent = rtd && rtd.id ? rtd.id : "—";
    el.querySelector("#rtd_value").textContent = (rtd && rtd.value != null) ? rtd.value : "—";

    const status = rtd && rtd.status ? rtd.status : "—";
    const pill = el.querySelector("#rtd_status");
    pill.textContent = status;
    pill.className = statusClass(status);

    const ts = (rtd && rtd.updatedAt) ? new Date(rtd.updatedAt) : null;
    el.querySelector("#rtd_time").textContent = ts ? `Updated ${ts.toLocaleTimeString()}` : "—";

    el.querySelector("#rtd_error").textContent = (rtd && rtd.error) ? rtd.error : "";
  });

  return el;
}
