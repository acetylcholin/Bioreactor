// src/client/pages/dashboard.js
import { TemperaturePanel } from "../components/TemperaturePanel.js";
import { PhPanel } from "../components/PhPanel.js";
import { ThermostatPanel } from "../components/ThermostatPanel.js";
import { PumpPanel } from "../components/PumpPanel.js";
import { ProcessPanel } from "../components/ProcessPanel.js";
import { StirringPanel } from "../components/StirringPanel.js";
import { IlluminationPanel } from "../components/IlluminationPanel.js";

export function mountDashboard(rootEl) {
  rootEl.innerHTML = `
    <div class="header">
      <div class="headerInner">
        <div class="titleWrap">
          <h1 class="title">Fermentor</h1>
          <p class="subtitle">Live process dashboard</p>
        </div>

        <div style="display:flex; gap:10px; align-items:center;">
          <a class="tileButton" href="/viz.html" style="text-decoration:none; display:inline-flex; align-items:center;">
            Visualization
          </a>
          <a class="tileButton" href="/control.html" style="text-decoration:none;">Control settings</a>
          <div id="conn" class="badge">Connecting…</div>
        </div>
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

  const grid = rootEl.querySelector("#grid");
  const process = rootEl.querySelector("#process");

  process.appendChild(ProcessPanel());
  grid.appendChild(TemperaturePanel());
  grid.appendChild(PhPanel());
  grid.appendChild(ThermostatPanel());
  grid.appendChild(PumpPanel());
  grid.appendChild(StirringPanel());
  grid.appendChild(IlluminationPanel());

  document.addEventListener("onconnectionchange", (e) => {
    rootEl.querySelector("#conn").textContent = e.detail;
  });
}
