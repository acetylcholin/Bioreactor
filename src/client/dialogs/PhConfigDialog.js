// src/client/dialogs/PhConfigDialog.js
// UI: overlay modal (same pattern as PumpConfigDialog)
// Purpose: pH calibration workflow (Low/Mid/High/Clear), live device info

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function safe(v, fallback = "—") {
  return (v === undefined || v === null || v === "") ? fallback : v;
}

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "ok") return "pill ok";
  if (!s || s === "—") return "pill";
  return "pill bad";
}

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return `Updated ${new Date(ts).toLocaleTimeString()}`;
  } catch {
    return "—";
  }
}

export function openPhConfigDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <div class="modalHeader">
        <div class="modalTitle">Configure pH Sensor</div>
        <button class="button" id="close">Close</button>
      </div>

      <div class="modalBody">
        <div style="display:grid; gap:16px;">

          <!-- Live status block -->
          <div style="display:grid; gap:10px; padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <div>
                <div style="font-weight:700;">Atlas EZO pH (I²C)</div>
                <div class="mono" style="color: var(--muted-color); font-size:12px;">
                  Device ID: <span id="ph_id">—</span>
                </div>
              </div>
              <span class="pill" id="ph_status">—</span>
            </div>

            <div style="display:flex; align-items:baseline; gap:10px; padding-top:4px;">
              <div style="font-size:40px; font-weight:800; letter-spacing:-0.02em;" id="ph_value">—</div>
              <div style="font-size:16px; font-weight:700;" id="ph_unit">pH</div>
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <span class="pill">Cal: <span class="mono" id="ph_cal">—</span></span>
              <span class="pill">Slope: <span class="mono" id="ph_slope">—</span></span>
              <span class="pill">Comp: <span class="mono" id="ph_comp">—</span></span>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <div class="mono" style="color: var(--muted-color); font-size:12px;" id="ph_time">—</div>
              <div style="color:#ff8a8a; font-size:12px; min-height:14px;" id="ph_error"></div>
            </div>
          </div>

          <!-- Calibration instructions -->
          <div style="display:grid; gap:10px; padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:16px;">
            <div style="font-weight:700;">Calibration</div>
            <div style="color: var(--muted-color); font-size:12px; line-height:1.45;">
              Recommended workflow:
              <ol style="margin:6px 0 0 16px; padding:0;">
                <li>Rinse probe with distilled water, gently shake off drops.</li>
                <li>Calibrate <b>Mid</b> first (7.00), then <b>Low</b> (4.00) or <b>High</b> (10.00).</li>
                <li>Stir gently and wait for the reading to stabilize before pressing a calibration button.</li>
              </ol>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <label>
                <div style="color: var(--muted-color); font-size:12px;">Buffer (pH)</div>
                <input id="bufferValue" class="button" type="number" step="0.01" value="7.00" style="width:100%;"/>
                <div style="color: var(--muted-color); font-size:12px; margin-top:6px;">
                  Tip: set 7.00 / 4.00 / 10.00 depending on your solution.
                </div>
              </label>

              <div style="display:grid; gap:10px;">
                <button class="button" id="btnMid">Calibrate MID</button>
                <button class="button" id="btnLow">Calibrate LOW</button>
                <button class="button" id="btnHigh">Calibrate HIGH</button>
              </div>
            </div>

            <div style="display:flex; gap:10px; justify-content:space-between; align-items:center; flex-wrap:wrap;">
              <button class="button" id="btnClear" style="border-color: rgba(255,0,0,0.18);">Clear Calibration</button>
              <div class="mono" style="color: var(--muted-color); font-size:12px;" id="msg"></div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;

  const elMsg = overlay.querySelector("#msg");

  function setMsg(s) {
    elMsg.textContent = s || "";
  }

  async function doCal(point) {
    setMsg("");
    try {
      const value = Number(overlay.querySelector("#bufferValue").value);
      if (!Number.isFinite(value) || value <= 0) {
        setMsg("Invalid buffer value.");
        return;
      }
      setMsg("Working...");
      await post("/api/ph/calibrate", { point, value });
      setMsg(`Calibration saved (${point.toUpperCase()} @ ${value.toFixed(2)}).`);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  }

  overlay.querySelector("#btnMid").addEventListener("click", () => doCal("mid"));
  overlay.querySelector("#btnLow").addEventListener("click", () => doCal("low"));
  overlay.querySelector("#btnHigh").addEventListener("click", () => doCal("high"));

  overlay.querySelector("#btnClear").addEventListener("click", async () => {
    setMsg("");
    try {
      setMsg("Working...");
      await post("/api/ph/clear", {});
      setMsg("Calibration cleared.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  // Live device updates
  function onUpdate(event) {
    const ph = (event.detail || {}).ezophSensor || null;

    overlay.querySelector("#ph_id").textContent = safe(ph && ph.id);
    overlay.querySelector("#ph_unit").textContent = safe(ph && ph.unit, "pH");

    const status = safe(ph && ph.status);
    const pill = overlay.querySelector("#ph_status");
    pill.textContent = status;
    pill.className = statusClass(status);

    overlay.querySelector("#ph_value").textContent =
      (ph && ph.value != null) ? ph.value : "—";

    overlay.querySelector("#ph_cal").textContent =
      safe(ph && ph.calibrationStatus);

    overlay.querySelector("#ph_slope").textContent =
      safe(ph && ph.slope);

    // show compensation temp (you already wanted "Comp: 22.20°C" style)
    const comp = (ph && (ph.compTemp ?? ph.internalTemperature)) ?? null;
    overlay.querySelector("#ph_comp").textContent =
      (comp != null && comp !== "N/A") ? `${comp}°C` : "—";

    overlay.querySelector("#ph_time").textContent = fmtTime(ph && ph.updatedAt);
    overlay.querySelector("#ph_error").textContent = safe(ph && ph.error, "");
  }

  const handler = onUpdate.bind(null);

  document.addEventListener("onupdatedevices", handler);
  // first paint using last snapshot if available
  if (window.application && window.application.devices) {
    onUpdate({ detail: window.application.devices });
  }

  function close() {
    document.removeEventListener("onupdatedevices", handler);
    overlay.remove();
  }

  overlay.querySelector("#close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  document.body.appendChild(overlay);
}
