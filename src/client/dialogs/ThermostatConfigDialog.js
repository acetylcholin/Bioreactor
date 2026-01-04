export function openThermostatConfigDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  overlay.innerHTML = `
    <div class="modal">
      <div class="modalHeader">
        <div class="modalTitle">Configure Thermostat</div>
        <button class="button" id="close">Close</button>
      </div>

      <div class="modalBody">
        <div style="display:grid; gap:10px;">
          <label>
            <div style="color: var(--muted-color); font-size:12px;">PWM Percentage</div>
            <input id="pct" type="range" min="0" max="100" value="0" style="width:100%;" />
            <div style="display:flex; justify-content:space-between; font-size:12px; color: var(--muted-color);">
              <span>0%</span><span id="pctVal">0%</span><span>100%</span>
            </div>
          </label>

          <label>
            <div style="color: var(--muted-color); font-size:12px;">Mode</div>
            <select id="mode" class="button" style="width:100%;">
              <option value="0">Cooling</option>
              <option value="1">Heating</option>
            </select>
          </label>

          <div style="display:flex; gap:10px; justify-content:flex-end; padding-top:6px;">
            <button class="button" id="applyPct">Apply %</button>
            <button class="button" id="applyMode">Apply Mode</button>
          </div>

          <div id="msg" style="color: var(--muted-color); font-size:12px;"></div>
        </div>
      </div>
    </div>
  `;

  const pct = overlay.querySelector("#pct");
  const pctVal = overlay.querySelector("#pctVal");
  pct.addEventListener("input", () => (pctVal.textContent = `${pct.value}%`));

  async function post(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  overlay.querySelector("#applyPct").addEventListener("click", async () => {
    const msg = overlay.querySelector("#msg");
    try {
      await post("/api/thermostat/percentage", { percentage: Number(pct.value) });
      msg.textContent = "PWM updated.";
    } catch (e) {
      msg.textContent = `Error: ${e.message}`;
    }
  });

  overlay.querySelector("#applyMode").addEventListener("click", async () => {
    const msg = overlay.querySelector("#msg");
    try {
      const mode = Number(overlay.querySelector("#mode").value);
      await post("/api/thermostat/mode", { mode });
      msg.textContent = "Mode updated.";
    } catch (e) {
      msg.textContent = `Error: ${e.message}`;
    }
  });

  overlay.querySelector("#close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  document.body.appendChild(overlay);
}
