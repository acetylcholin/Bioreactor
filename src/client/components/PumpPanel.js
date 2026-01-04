import { openPumpConfigDialog } from "../dialogs/PumpConfigDialog.js";
import { openPumpOverviewDialog } from "../dialogs/PumpOverviewDialog.js";

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "ok") return "pill ok";
  if (!s || s === "—") return "pill";
  return "pill bad";
}

export function PumpPanel() {
  const el = document.createElement("section");
  el.className = "tile";

  const saved = localStorage.getItem("selectedPump") || "acid";

  el.innerHTML = `
<div class="tileHeader">
  <div class="tileTitle">
    <h2>Peristaltic Pump</h2>
    <p>I²C Pump Board (0x10)</p>
  </div>

  <!-- Overview icon -->
  <button class="iconBtn" id="btnOverview" title="Show all pumps">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M4 12h16M4 17h16"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"/>
    </svg>
  </button>
</div>
    

    <div class="tileBody">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div>
          <div style="color: var(--muted-color); font-size:12px;">Pump</div>
          <select id="pumpSelect" class="button" style="margin-top:6px;">
            <option value="acid">Acid</option>
            <option value="base">Base</option>
            <option value="antifoam">Antifoam</option>
            <option value="feed">Feed</option>
          </select>
        </div>

        <span class="pill" id="pump_status">—</span>
      </div>

      <!-- MAIN VALUE: mL/h -->
      <div class="tileValue" style="margin-top:12px;">
        <div class="num" id="pump_mlh_num">—</div>
        <div class="unit">mL/h</div>
      </div>

      <div class="tileMeta" style="margin-top:10px;">
        <span class="pill" id="pump_sum">Sum — mL</span>
      </div>
    </div>

    <div class="tileFooter">
      <div>
        <div>Calibration</div>
        <div class="mono" id="pump_cal">—</div>
      </div>

      <div style="text-align:right;">
        <div id="pump_time">—</div>
        <div id="pump_error" style="color:#ff8a8a; min-height:14px;"></div>
      </div>

      <button class="tileButton" id="btnConfig">Configure</button>
    </div>
  `;

  const sel = el.querySelector("#pumpSelect");
  sel.value = saved;

  function getSelected() {
    return sel.value;
  }

  el.querySelector("#btnConfig").addEventListener("click", () => {
    openPumpConfigDialog(getSelected());
  });

  sel.addEventListener("change", () => {
    localStorage.setItem("selectedPump", sel.value);
    if (window.application && window.application.devices) {
      document.dispatchEvent(new CustomEvent("onupdatedevices", { detail: window.application.devices }));
    }
  });

  document.addEventListener("onupdatedevices", (event) => {
    const devices = event.detail || {};
    window.application = window.application || {};
    window.application.devices = devices;

    const board = devices.pumps || null;
    const type = getSelected();
    const p = board && board.pumps ? board.pumps[type] : null;

    const status = p && p.status ? p.status : "—";
    const pill = el.querySelector("#pump_status");
    pill.textContent = status;
    pill.className = statusClass(status);

    el.querySelector("#pump_mlh_num").textContent = (p && p.mlh != null) ? p.mlh : "—";
    el.querySelector("#pump_sum").textContent = (p && p.sumML != null) ? `Sum ${p.sumML} mL` : "Sum — mL";
    el.querySelector("#pump_cal").textContent = (p && p.calibrationStatus) ? p.calibrationStatus : "—";
    el.querySelector("#btnOverview").addEventListener("click", () => {
    openPumpOverviewDialog();
    });


    const ts = (p && p.updatedAt) ? new Date(p.updatedAt) : null;
    el.querySelector("#pump_time").textContent = ts ? `Updated ${ts.toLocaleTimeString()}` : "—";

    el.querySelector("#pump_error").textContent =
      (p && p.error) ? p.error : (board && board.error ? board.error : "");
  });

  return el;
}
