// IlluminationConfigDialog.js (server-backed schedule; no browser controller)

// -------------------------
// Illumination (direct control)
// -------------------------
async function postSettings(settings) {
  const resp = await fetch("/api/illumination/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
}

// -------------------------
// Light schedule (server-backed)
// -------------------------
async function fetchSchedule() {
  const resp = await fetch("/api/illumination/schedule");
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data.schedule;
}

async function saveSchedule(schedule) {
  const resp = await fetch("/api/illumination/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schedule),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
}

function defaultLightSchedule() {
  return {
    enabled: false,

    sunriseStart: "05:00",
    sunriseEnd: "09:00",
    sunriseColorStart: "#fff08a",
    sunriseColorEnd: "#ff3b30",

    sunsetEnabled: false,
    sunsetStart: "18:00",
    sunsetEnd: "21:00",
    sunsetColorStart: "#ff3b30",
    sunsetColorEnd: "#fff08a",

    // ✅ matches server defaults/logic
    holdAfterSunrise: true,
    turnOffAfterSunset: true,

    // informational only; server enforces >= 6000 anyway
    tickMs: 6000,
  };
}

async function openLightScheduleDialog() {
  const cur = (await fetchSchedule().catch(() => null)) || defaultLightSchedule();

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.55)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "10000";

  overlay.innerHTML = `
    <div style="width: min(560px, 94vw); background: rgba(20,20,24,.98); border: 1px solid rgba(255,255,255,.12); border-radius: 16px; padding: 16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div>
          <div style="font-weight:700; font-size:16px;">Light Scheduler</div>
          <div style="opacity:.75; font-size:12px;">Runs on the Raspberry Pi (works even if browser is closed)</div>
        </div>
        <button id="close" class="tileButton">Close</button>
      </div>

      <div style="margin-top:14px; display:grid; gap:12px;">
        <label style="display:flex; align-items:center; gap:10px;">
          <input id="enabled" type="checkbox" ${cur.enabled ? "checked" : ""} />
          <span>Enable scheduler</span>
        </label>

        <div style="display:grid; gap:10px; padding:12px; border:1px solid rgba(255,255,255,.10); border-radius:12px;">
          <div style="font-weight:600; opacity:.9;">Sunrise (ramp 0% → 100%)</div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <label style="display:grid; gap:6px;">
              <span style="opacity:.8;">Start time</span>
              <input id="srStart" type="time" value="${cur.sunriseStart || "05:00"}" />
            </label>

            <label style="display:grid; gap:6px;">
              <span style="opacity:.8;">End time</span>
              <input id="srEnd" type="time" value="${cur.sunriseEnd || "09:00"}" />
            </label>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <label style="display:grid; gap:6px;">
              <span style="opacity:.8;">Color start</span>
              <input id="srColorA" type="color" value="${cur.sunriseColorStart || "#fff08a"}" style="width: 84px; height: 42px; border:none; background:transparent;" />
            </label>

            <label style="display:grid; gap:6px;">
              <span style="opacity:.8;">Color end</span>
              <input id="srColorB" type="color" value="${cur.sunriseColorEnd || "#ff3b30"}" style="width: 84px; height: 42px; border:none; background:transparent;" />
            </label>
          </div>
        </div>

        <div style="display:grid; gap:10px; padding:12px; border:1px solid rgba(255,255,255,.10); border-radius:12px;">
          <label style="display:flex; align-items:center; gap:10px;">
            <input id="ssEnabled" type="checkbox" ${cur.sunsetEnabled ? "checked" : ""} />
            <span>Enable sunset (ramp 100% → 0%)</span>
          </label>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <label style="display:grid; gap:6px;">
              <span style="opacity:.8;">Sunset start</span>
              <input id="ssStart" type="time" value="${cur.sunsetStart || "18:00"}" />
            </label>

            <label style="display:grid; gap:6px;">
              <span style="opacity:.8;">Sunset end</span>
              <input id="ssEnd" type="time" value="${cur.sunsetEnd || "21:00"}" />
            </label>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <label style="display:grid; gap:6px;">
              <span style="opacity:.8;">Color start</span>
              <input id="ssColorA" type="color" value="${cur.sunsetColorStart || "#ff3b30"}" style="width: 84px; height: 42px; border:none; background:transparent;" />
            </label>

            <label style="display:grid; gap:6px;">
              <span style="opacity:.8;">Color end</span>
              <input id="ssColorB" type="color" value="${cur.sunsetColorEnd || "#fff08a"}" style="width: 84px; height: 42px; border:none; background:transparent;" />
            </label>
          </div>

          <div style="opacity:.75; font-size:12px;">
            Server tick is fixed to 6s minimum (hardware safety).
          </div>
        </div>

        <div style="display:grid; gap:10px; padding:12px; border:1px solid rgba(255,255,255,.10); border-radius:12px;">
          <div style="font-weight:600; opacity:.9;">After-ramp behavior</div>

          <label style="display:flex; align-items:center; gap:10px;">
            <input id="holdAfterSunrise" type="checkbox" ${cur.holdAfterSunrise !== false ? "checked" : ""} />
            <span>Hold 100% after sunrise until sunset</span>
          </label>

          <label style="display:flex; align-items:center; gap:10px;">
            <input id="turnOffAfterSunset" type="checkbox" ${cur.turnOffAfterSunset !== false ? "checked" : ""} />
            <span>Turn off after sunset</span>
          </label>

          <div style="opacity:.75; font-size:12px;">
            These prevent the light from getting “stuck” at a low % after the ramp ends.
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:6px;">
          <button id="cancel" class="tileButton">Cancel</button>
          <button id="save" class="tileButton">Save</button>
        </div>
      </div>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.querySelector("#cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelector("#save").addEventListener("click", async () => {
    try {
      const next = {
        ...cur,

        enabled: overlay.querySelector("#enabled").checked,

        sunriseStart: overlay.querySelector("#srStart").value || "05:00",
        sunriseEnd: overlay.querySelector("#srEnd").value || "09:00",
        sunriseColorStart: overlay.querySelector("#srColorA").value || "#fff08a",
        sunriseColorEnd: overlay.querySelector("#srColorB").value || "#ff3b30",

        sunsetEnabled: overlay.querySelector("#ssEnabled").checked,
        sunsetStart: overlay.querySelector("#ssStart").value || "18:00",
        sunsetEnd: overlay.querySelector("#ssEnd").value || "21:00",
        sunsetColorStart: overlay.querySelector("#ssColorA").value || "#ff3b30",
        sunsetColorEnd: overlay.querySelector("#ssColorB").value || "#fff08a",

        holdAfterSunrise: overlay.querySelector("#holdAfterSunrise").checked,
        turnOffAfterSunset: overlay.querySelector("#turnOffAfterSunset").checked,

        tickMs: 6000,
      };

      await saveSchedule(next);
      close();
    } catch (e) {
      alert("Failed to save light schedule: " + (e?.message || e));
    }
  });

  document.body.appendChild(overlay);
}

// -------------------------
// Main illumination config dialog (manual color/intensity)
// -------------------------
export function openIlluminationConfigDialog() {
  const cur = window.application?.devices?.illumination?.settings || {
    enabled: false,
    color: "#000000",
    intensity: 100,
  };

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.55)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";

  overlay.innerHTML = `
    <div style="width: min(520px, 92vw); background: rgba(20,20,24,.98); border: 1px solid rgba(255,255,255,.12); border-radius: 16px; padding: 16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div>
          <div style="font-weight:700; font-size: 16px;">Configure Illumination</div>
          <div style="opacity:.75; font-size: 12px;">Set color and intensity</div>
        </div>
        <button id="close" class="tileButton">Close</button>
      </div>

      <div style="margin-top:14px; display:grid; gap:12px;">
        <label style="display:flex; align-items:center; gap:10px;">
          <input id="enabled" type="checkbox" ${cur.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>

        <label style="display:grid; gap:6px;">
          <span style="opacity:.8;">Color</span>
          <input id="color" type="color" value="${cur.color || "#000000"}" style="width: 72px; height: 42px; border:none; background:transparent;" />
        </label>

        <label style="display:grid; gap:6px;">
          <span style="opacity:.8;">Intensity: <span id="ival">${cur.intensity ?? 100}</span>%</span>
          <input id="intensity" type="range" min="0" max="100" step="1" value="${cur.intensity ?? 100}" />
        </label>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:6px;">
          <button id="settings" class="tileButton">Settings</button>
          <button id="cancel" class="tileButton">Cancel</button>
          <button id="save" class="tileButton">Save</button>
        </div>
      </div>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.querySelector("#close").addEventListener("click", close);
  overlay.querySelector("#cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelector("#settings").addEventListener("click", async () => {
    await openLightScheduleDialog();
  });

  const intensityEl = overlay.querySelector("#intensity");
  const ivalEl = overlay.querySelector("#ival");
  intensityEl.addEventListener("input", () => {
    ivalEl.textContent = intensityEl.value;
  });

  overlay.querySelector("#save").addEventListener("click", async () => {
    const settings = {
      enabled: overlay.querySelector("#enabled").checked,
      color: overlay.querySelector("#color").value,
      intensity: Number(overlay.querySelector("#intensity").value),
    };
    try {
      await postSettings(settings);
      close();
    } catch (e) {
      alert("Failed to save illumination settings: " + (e?.message || e));
    }
  });

  document.body.appendChild(overlay);
}