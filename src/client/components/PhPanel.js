import { openPhConfigDialog } from "../dialogs/PhConfigDialog.js";

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "ok") return "pill ok";
  if (!s || s === "—") return "pill";
  return "pill bad";
}

export function PhPanel() {
  const el = document.createElement("section");
  el.className = "tile";

  el.innerHTML = `
    <div class="tileHeader">
      <div class="tileTitle">
        <h2>pH</h2>
        <p>Atlas EZO pH • I²C</p>
      </div>

      <div class="tileIcon" title="pH">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2s4 6 4 10a4 4 0 0 1-8 0c0-4 4-10 4-10Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          <path d="M8 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    </div>

    <div class="tileBody">
      <div class="tileValue">
        <div class="num" id="ph_value">—</div>
        <div class="unit">pH</div>
      </div>

      <div class="tileMeta">
        <span class="pill" id="ph_status">—</span>
      </div>
    </div>

    <div class="tileFooter">
      <div>
        <div>Device</div>
        <div class="mono" id="ph_id">—</div>
      </div>

      <div style="text-align:right;">
        <div id="ph_time">—</div>
        <div id="ph_comp" style="color: var(--muted-color); font-size: 12px;">—</div>
	<div id="ph_error" style="color:#ff8a8a; min-height:14px;"></div>
      </div>

      <button class="tileButton" id="btnConfig">Configure</button>
    </div>
  `;

  el.querySelector("#btnConfig").addEventListener("click", () => openPhConfigDialog());

document.addEventListener("onupdatedevices", (event) => {
  const ph = (event.detail || {}).ezophSensor || null;

  el.querySelector("#ph_id").textContent = ph && ph.id ? ph.id : "—";
  el.querySelector("#ph_value").textContent = (ph && ph.value != null) ? ph.value : "—";

  const status = ph && ph.status ? ph.status : "—";
  const pill = el.querySelector("#ph_status");
  pill.textContent = status;
  pill.className = statusClass(status);

  const ts = (ph && ph.updatedAt) ? new Date(ph.updatedAt) : null;
  el.querySelector("#ph_time").textContent = ts ? `Updated ${ts.toLocaleTimeString()}` : "—";

  const comp = (ph && ph.compTempC != null)
    ? `Comp: ${Number(ph.compTempC).toFixed(2)} °C`
    : "";
  el.querySelector("#ph_comp").textContent = comp;

  el.querySelector("#ph_error").textContent = (ph && ph.error) ? ph.error : "";
});

  return el;
}
