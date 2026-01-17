import { TemperaturePanel } from "../components/TemperaturePanel.js";
import { PhPanel } from "../components/PhPanel.js";
import { ThermostatPanel } from "../components/ThermostatPanel.js";
import { PumpPanel } from "../components/PumpPanel.js";
import { ProcessPanel } from "../components/ProcessPanel.js";
import { StirringPanel } from "../components/StirringPanel.js";

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

  <section class="processSection">
  <div class="sectionTitle">Process Control</div>
    <div id="process"></div>
  </section>

  <section class="tilesSection">
    <div id="grid" class="tiles"></div>
  </section>

</div>
  `;

  // 🔹 Mount ProcessPanel FIRST (top section)
  const processRoot = rootEl.querySelector("#process");
  processRoot.appendChild(ProcessPanel());

  // 🔹 Mount tiles (unchanged)
  const grid = rootEl.querySelector("#grid");
  grid.appendChild(TemperaturePanel());
  grid.appendChild(PhPanel());
  grid.appendChild(ThermostatPanel());
  grid.appendChild(PumpPanel());
  grid.appendChild(StirringPanel());

  // 🔹 Connection badge
  document.addEventListener("onconnectionchange", (e) => {
    rootEl.querySelector("#conn").textContent = e.detail;
  });
}

