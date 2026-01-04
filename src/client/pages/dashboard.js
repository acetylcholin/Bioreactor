import { TemperaturePanel } from "../components/TemperaturePanel.js";
import { PhPanel } from "../components/PhPanel.js";
import { ThermostatPanel } from "../components/ThermostatPanel.js";
import { PumpPanel } from "../components/PumpPanel.js";

export function mountDashboard(rootEl) {
  rootEl.innerHTML = `
    <div class="header">
      <div class="headerInner">
        <div class="titleWrap">
          <h1 class="title">Fermentor</h1>
          <p class="subtitle">Live process dashboard</p>
        </div>
        <div id="conn" class="badge">Connecting…</div>
      </div>
    </div>

    <div class="main">
      <div id="grid" class="tiles"></div>
    </div>
  `;

  const grid = rootEl.querySelector("#grid");
  grid.appendChild(TemperaturePanel());
  grid.appendChild(PhPanel());
  grid.appendChild(ThermostatPanel());
  grid.appendChild(PumpPanel());
  document.addEventListener("onconnectionchange", (e) => {
    rootEl.querySelector("#conn").textContent = e.detail;
  });
}
