import { openThermostatConfigDialog } from "../dialogs/ThermostatConfigDialog.js";

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "ok") return "pill ok";
  if (!s || s === "—") return "pill";
  return "pill bad";
}

function modeLabel(m) {
  return Number(m) === 1 ? "Heating" : "Cooling";
}

export function ThermostatPanel() {
  const el = document.createElement("section");
  el.className = "tile";

  el.innerHTML = `
    <div class="tileHeader">
      <div class="tileTitle">
        <h2>Thermostat</h2>
        <p>Peltier PWM + INA219</p>
      </div>
      <div class="tileIcon" title="Thermostat">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2v20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M7 7h10M7 12h10M7 17h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    </div>

    <div class="tileBody">
      <div class="tileValue">
        <div class="num" id="th_pct">0</div>
        <div class="unit">%</div>
      </div>

      <div class="tileMeta">
        <span class="pill" id="th_status">—</span>
        <span class="pill" id="th_mode">Cooling</span>
      </div>
    </div>

    <div class="tileFooter">
      <div>
        <div>Power</div>
        <div class="mono" id="th_power">— W</div>
      </div>

      <div style="text-align:right;">
        <div id="th_time">—</div>
        <div style="color: var(--muted-color); font-size: 12px;" id="th_meas">—</div>
        <div id="th_error" style="color:#ff8a8a; min-height:14px;"></div>
      </div>

      <button class="tileButton" id="btnConfig">Configure</button>
    </div>
  `;

  el.querySelector("#btnConfig").addEventListener("click", () => {
    openThermostatConfigDialog();
  });

  document.addEventListener("onupdatedevices", (event) => {
    const th = (event.detail || {}).thermostat || null;

    const pct = th && th.percentage != null ? th.percentage : 0;
    el.querySelector("#th_pct").textContent = pct;

    const st = th && th.status ? th.status : "—";
    const pill = el.querySelector("#th_status");
    pill.textContent = st;
    pill.className = statusClass(st);

    el.querySelector("#th_mode").textContent = modeLabel(th && th.mode);

    const power = th && th.power != null ? `${th.power.toFixed ? th.power.toFixed(2) : th.power} W` : "— W";
    el.querySelector("#th_power").textContent = power;

    const meas =
      th && th.voltage != null && th.current != null
        ? `${th.voltage} V • ${th.current} A`
        : "—";
    el.querySelector("#th_meas").textContent = meas;

    const ts = th && th.updatedAt ? new Date(th.updatedAt) : null;
    el.querySelector("#th_time").textContent = ts ? `Updated ${ts.toLocaleTimeString()}` : "—";

    el.querySelector("#th_error").textContent = th && th.error ? th.error : "";
  });

  return el;
}
