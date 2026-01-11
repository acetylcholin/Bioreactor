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

async function get(url) {
  const res = await fetch(url);
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
  try { return `Updated ${new Date(ts).toLocaleTimeString()}`; } catch { return "—"; }
}

export function openTemperatureConfigDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <div class="modalHeader">
        <div class="modalTitle">Configure Temperature Sensor</div>
        <button class="button" id="close">Close</button>
      </div>

      <div class="modalBody">
        <div style="display:grid; gap:16px;">

          <!-- Live status -->
          <div style="display:grid; gap:10px; padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <div>
                <div style="font-weight:700;">Atlas EZO RTD (I²C)</div>
                <div class="mono" style="color: var(--muted-color); font-size:12px;">
                  Device ID: <span id="t_id">—</span>
                </div>
              </div>
              <span class="pill" id="t_status">—</span>
            </div>

            <div style="display:flex; align-items:baseline; gap:10px; padding-top:4px;">
              <div style="font-size:40px; font-weight:800; letter-spacing:-0.02em;" id="t_value">—</div>
              <div style="font-size:16px; font-weight:700;" id="t_unit">°C</div>
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <span class="pill">Cal: <span class="mono" id="t_cal">—</span></span>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <div class="mono" style="color: var(--muted-color); font-size:12px;" id="t_time">—</div>
              <div style="color:#ff8a8a; font-size:12px; min-height:14px;" id="t_error"></div>
            </div>
          </div>

          <!-- Calibration -->
          <div style="display:grid; gap:12px; padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:16px;">
            <div style="font-weight:700;">Calibration (single point)</div>

            <div style="color: var(--muted-color); font-size:12px; line-height:1.45;">
              The EZO RTD uses <b>single point calibration</b> using <code>Cal,t</code>. :contentReference[oaicite:4]{index=4}
              Put the probe in a stable reference temperature (ice bath ~0°C, boiling ~100°C, or a certified thermometer bath),
              wait until stable, then enter the known temperature and press Calibrate.
            </div>

            <label>
              <div style="color: var(--muted-color); font-size:12px;">Known temperature (°C)</div>
              <input id="knownTemp" class="button" type="number" step="0.01" value="100.00" style="width:100%;"/>
            </label>

            <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
              <button class="button" id="btnCheck">Check Cal Status</button>
              <button class="button" id="btnClear" style="border-color: rgba(255,0,0,0.18);">Clear Calibration</button>
              <button class="button" id="btnCal">Calibrate</button>
            </div>

            <div id="msg" class="mono" style="color: var(--muted-color); font-size:12px;"></div>
          </div>

        </div>
      </div>
    </div>
  `;

  const msg = overlay.querySelector("#msg");
  const setMsg = (s) => { msg.textContent = s || ""; };

  async function refreshCalStatusOnce() {
    setMsg("Working...");
    const r = await get("/api/temp/calstatus");
    setMsg(`Status: ${safe(r.status)}`);
  }

  overlay.querySelector("#btnCheck").addEventListener("click", async () => {
    try { await refreshCalStatusOnce(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  });

  overlay.querySelector("#btnClear").addEventListener("click", async () => {
    try {
      setMsg("Working...");
      await post("/api/temp/clear", {});
      setMsg("Calibration cleared.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  overlay.querySelector("#btnCal").addEventListener("click", async () => {
    try {
      const t = Number(overlay.querySelector("#knownTemp").value);
      if (!Number.isFinite(t)) { setMsg("Invalid temperature."); return; }
      setMsg("Working...");
      await post("/api/temp/calibrate", { tempC: t });
      setMsg(`Calibration saved (Cal,${t.toFixed(2)}).`);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  const onUpdate = (event) => {
    const temp = (event.detail || {}).ezortdSensor || null;

    overlay.querySelector("#t_id").textContent = safe(temp && temp.id);
    overlay.querySelector("#t_unit").textContent = safe(temp && temp.unit, "°C");

    const st = safe(temp && temp.status);
    const pill = overlay.querySelector("#t_status");
    pill.textContent = st;
    pill.className = statusClass(st);

    overlay.querySelector("#t_value").textContent =
      (temp && temp.value != null) ? temp.value : "—";

    overlay.querySelector("#t_cal").textContent =
      safe(temp && temp.calibrationStatus);

    overlay.querySelector("#t_time").textContent = fmtTime(temp && temp.updatedAt);
    overlay.querySelector("#t_error").textContent = (temp && temp.error) ? temp.error : "";
  };

  document.addEventListener("onupdatedevices", onUpdate);
  if (window.application && window.application.devices) {
    onUpdate({ detail: window.application.devices });
  }

  function close() {
    document.removeEventListener("onupdatedevices", onUpdate);
    overlay.remove();
  }
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  document.body.appendChild(overlay);
}

