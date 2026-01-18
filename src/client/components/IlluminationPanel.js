import { openIlluminationConfigDialog } from "../dialogs/IlluminationConfigDialog.js";

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "ok") return "pill ok";
  if (!s || s === "—" || s === "disconnected") return "pill";
  return "pill bad";
}

async function postPower(enabled) {
  await fetch("/api/illumination/power", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export function IlluminationPanel() {
  const el = document.createElement("section");
  el.className = "tile";
  el.style.display = "none";

  el.innerHTML = `
    <div class="tileHeader">
      <div class="tileTitle">
        <h2>Illumination</h2>
        <p>FTDI • USB Serial</p>
      </div>
      <div class="tileIcon" title="Illumination">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M9 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M10 22h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M12 2a7 7 0 0 0-4 12c.7.7 1 1.4 1 2h6c0-.6.3-1.3 1-2A7 7 0 0 0 12 2Z"
                stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <div class="tileBody">
      <div class="tileValue" style="gap:12px; align-items:center;">
        <div id="illum_swatch" style="width:52px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.12);"></div>
        <div>
          <div class="num mono" id="illum_hex">—</div>
          <div class="unit" id="illum_intensity">Intensity —%</div>
        </div>
      </div>

      <div class="tileMeta">
        <span class="pill" id="illum_status">—</span>
      </div>
    </div>

    <div class="tileFooter">
      <div>
        <div>Device</div>
        <div class="mono" id="illum_id">—</div>
      </div>

      <div style="text-align:right;">
        <div id="illum_time">—</div>
        <div id="illum_error" style="color:#ff7b7b; min-height:14px;"></div>
      </div>

      <button class="tileButton" id="illum_power">On</button>
      <button class="tileButton" id="illum_config">Configure</button>
    </div>
  `;

  const swatch = el.querySelector("#illum_swatch");
  const hexEl = el.querySelector("#illum_hex");
  const intenEl = el.querySelector("#illum_intensity");
  const powerBtn = el.querySelector("#illum_power");

  el.querySelector("#illum_config").addEventListener("click", () => {
    openIlluminationConfigDialog();
  });

  powerBtn.addEventListener("click", async () => {
    const enabled = powerBtn.dataset.enabled === "true";
    try {
      await postPower(!enabled);
    } catch {}
  });

  document.addEventListener("onupdatedevices", (event) => {
    const devices = event.detail || {};
    const illum = devices.illumination || null;

    // show tile only when module present
    const visible = illum && illum.status === "Ok";
    el.style.display = visible ? "" : "none";
    if (!visible) return;

    const status = illum.status || "—";
    const pill = el.querySelector("#illum_status");
    pill.textContent = status;
    pill.className = statusClass(status);

    el.querySelector("#illum_id").textContent =
      illum.identity?.product
        ? `${illum.identity.product} • ${illum.identity.serial || "?"}`
        : (illum.id || "—");

    const ts = illum.updatedAt ? new Date(illum.updatedAt) : null;
    el.querySelector("#illum_time").textContent =
      ts ? `Updated ${ts.toLocaleTimeString()}` : "—";

    el.querySelector("#illum_error").textContent = illum.error || "";

    const settings = illum.settings || { enabled: false, color: "#000000", intensity: 100 };
    swatch.style.background = settings.color || "#000000";
    hexEl.textContent = settings.color || "#000000";
    intenEl.textContent = `Intensity ${settings.intensity ?? "—"}%`;

    powerBtn.dataset.enabled = settings.enabled ? "true" : "false";
    powerBtn.textContent = settings.enabled ? "Off" : "On";
  });

  return el;
}
