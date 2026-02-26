// src/client/components/ProcessPanel.js

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

function safe(v, fallback = "") {
  return (v === undefined || v === null) ? fallback : v;
}

function isEditing(root) {
  const a = document.activeElement;
  if (!a) return false;
  return root.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
}

export function ProcessPanel() {
  const el = document.createElement("section");
  el.className = "panel";

  el.innerHTML = `
    <div class="panelHeader" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <div>
        <div style="font-weight:800; font-size:18px;">Fermentation</div>
        <div class="mono" style="color: var(--muted-color); font-size:12px;">
          <span id="proc_status">Status: —</span>
          <span style="margin-left:10px;" id="proc_t0">t0: —</span>
          <span style="margin-left:10px;" id="proc_ready">Ready: —</span>
        </div>
      </div>

      <div style="display:flex; gap:10px; align-items:center;">
        <button class="tileButton" id="btnToggle">Setup</button>

        <button class="tileButton" id="btnStart">Start</button>

        <button class="tileButton" id="btnInoculate" disabled
          style="opacity:.55; border:1px solid rgba(255,255,255,.12);">
          Inoculate
        </button>

        <button class="tileButton" id="btnStop">Stop</button>
      </div>
    </div>

    <div id="body" style="display:none; margin-top:12px;">
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <div style="padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:16px;">
          <div style="font-weight:700; margin-bottom:10px;">Basic</div>

          <label style="display:block; margin-bottom:8px;">
            <div style="color:var(--muted-color); font-size:12px;">Batch number</div>
            <input class="button" id="batchNumber" placeholder="e.g. 2026-01-11-A" style="width:100%;">
          </label>

          <label style="display:block; margin-bottom:8px;">
            <div style="color:var(--muted-color); font-size:12px;">Operator</div>
            <input class="button" id="operator" placeholder="Name" style="width:100%;">
          </label>

          <label style="display:block;">
            <div style="color:var(--muted-color); font-size:12px;">Notes</div>
            <textarea class="button" id="notes" rows="3" placeholder="Optional..." style="width:100%;"></textarea>
          </label>
        </div>

        <div style="padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:16px;">
          <div style="font-weight:700; margin-bottom:10px;">Control settings</div>

          <label style="display:block; margin-bottom:8px;">
            <div style="color:var(--muted-color); font-size:12px;">Target Temperature (°C)</div>
            <input class="button" id="targetTempC" type="number" step="0.1" placeholder="e.g. 20.0" style="width:100%;">
          </label>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:8px;">
            <label style="display:block;">
              <div style="color:var(--muted-color); font-size:12px;">Target pH</div>
              <input class="button" id="targetPh" type="number" step="0.01" placeholder="e.g. 7.00" style="width:100%;">
            </label>

            <label style="display:block;">
              <div style="color:var(--muted-color); font-size:12px;">pH Deadband</div>
              <input class="button" id="phDeadband" type="number" step="0.01" value="0.05" style="width:100%;">
            </label>
          </div>

          <label style="display:block; margin-bottom:8px;">
            <div style="color:var(--muted-color); font-size:12px;">Feed rate (mL/h)</div>
            <input class="button" id="feedMlh" type="number" step="0.1" placeholder="e.g. 5.0" style="width:100%;">
          </label>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:8px;">
            <label style="display:block;">
              <div style="color:var(--muted-color); font-size:12px;">Target DO (%)</div>
              <input class="button" id="targetDoPct" type="number" step="0.1" placeholder="e.g. 20" style="width:100%;">
            </label>

            <label style="display:block;">
              <div style="color:var(--muted-color); font-size:12px;">Air flow (mL/min)</div>
              <input class="button" id="airFlowMlMin" type="number" step="0.1" placeholder="e.g. 50" style="width:100%;">
            </label>
          </div>

          <div class="mono" id="msg" style="margin-top:10px; color:var(--muted-color); font-size:12px;"></div>

          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:10px;">
            <button class="tileButton" id="btnSave">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const body = el.querySelector("#body");
  const msg = el.querySelector("#msg");
  const btnInoculate = el.querySelector("#btnInoculate");
  const btnStart = el.querySelector("#btnStart");
  const btnStop = el.querySelector("#btnStop");

  const setMsg = (s) => (msg.textContent = s || "");

  let hydratedOnce = false;
  let lastServerSettingsJSON = "";

  function hydrateFromSettings(s) {
    el.querySelector("#batchNumber").value = safe(s.batchNumber, "");
    el.querySelector("#operator").value = safe(s.operator, "");
    el.querySelector("#notes").value = safe(s.notes, "");

    el.querySelector("#targetTempC").value = safe(s.targetTempC, "");
    el.querySelector("#targetPh").value = safe(s.targetPh, "");
    el.querySelector("#phDeadband").value = safe(s.phDeadband, "0.05");
    el.querySelector("#feedMlh").value = safe(s.feedMlh, "");

    el.querySelector("#targetDoPct").value = safe(s.targetDoPct, "");
    el.querySelector("#airFlowMlMin").value = safe(s.airFlowMlMin, "");
  }

  function setInoculateReady(ready) {
    if (ready) {
      btnInoculate.disabled = false;
      btnInoculate.style.opacity = "1";
      btnInoculate.style.border = "1px solid rgba(60,255,140,.7)";
      btnInoculate.style.boxShadow = "0 0 0 2px rgba(60,255,140,.15) inset";
    } else {
      btnInoculate.disabled = true;
      btnInoculate.style.opacity = ".55";
      btnInoculate.style.border = "1px solid rgba(255,255,255,.12)";
      btnInoculate.style.boxShadow = "none";
    }
  }

  el.querySelector("#btnToggle").addEventListener("click", () => {
    const open = body.style.display === "none";
    body.style.display = open ? "block" : "none";
    if (open) hydratedOnce = false;
  });

  el.querySelector("#btnSave").addEventListener("click", async () => {
    try {
      setMsg("Saving...");
      const payload = {
        batchNumber: el.querySelector("#batchNumber").value || "",
        operator: el.querySelector("#operator").value || "",
        notes: el.querySelector("#notes").value || "",

        targetTempC: el.querySelector("#targetTempC").value,
        targetPh: el.querySelector("#targetPh").value,
        phDeadband: el.querySelector("#phDeadband").value,
        feedMlh: el.querySelector("#feedMlh").value,

        targetDoPct: el.querySelector("#targetDoPct").value,
        airFlowMlMin: el.querySelector("#airFlowMlMin").value,
      };

      await post("/api/process/settings", payload);

      hydratedOnce = false;
      setMsg("Saved.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  btnStart.addEventListener("click", async () => {
    try {
      setMsg("");
      await post("/api/process/start", {});
      setMsg("Started: temp control + logging active. Waiting for stability to inoculate…");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  btnInoculate.addEventListener("click", async () => {
    try {
      setMsg("");
      await post("/api/process/inoculate", {});
      setMsg("Inoculated: t0 set.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  btnStop.addEventListener("click", async () => {
    try {
      setMsg("");
      await post("/api/process/stop", {});
      setMsg("Process stopped.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  const onUpdate = (event) => {
    const proc = (event.detail || {}).process || null;

    const phase = proc?.phase || (proc?.running ? "RUNNING" : "IDLE");
    el.querySelector("#proc_status").textContent = `Status: ${phase}`;

    const t0 = proc && proc.t0 ? new Date(proc.t0).toLocaleString() : "—";
    el.querySelector("#proc_t0").textContent = `t0: ${t0}`;

    const ready = !!proc?.readyToInoculate;
    el.querySelector("#proc_ready").textContent = `Ready: ${ready ? "YES" : "NO"}`;
    setInoculateReady(ready);

    // simple UX: disable Start when already started/running
    const started = phase !== "IDLE";
    btnStart.disabled = started;
    btnStart.style.opacity = started ? ".65" : "1";

    const s = proc && proc.settings ? proc.settings : null;
    if (!s) return;

    const serverSettingsJSON = JSON.stringify(s);
    const userEditing = isEditing(el);
    const serverChanged = serverSettingsJSON !== lastServerSettingsJSON;

    if (!userEditing && (!hydratedOnce || serverChanged)) {
      hydrateFromSettings(s);
      hydratedOnce = true;
      lastServerSettingsJSON = serverSettingsJSON;
    } else {
      if (serverChanged) lastServerSettingsJSON = serverSettingsJSON;
    }
  };

  document.addEventListener("onupdatedevices", onUpdate);

  if (window.application && window.application.devices) {
    onUpdate({ detail: window.application.devices });
  }

  // default: inoculate disabled until server says ready
  setInoculateReady(false);

  return el;
}