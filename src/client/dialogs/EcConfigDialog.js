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

export function openEcConfigDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <div class="modalHeader">
        <div class="modalTitle">Configure EC Sensor</div>
        <button class="button" id="close">Close</button>
      </div>

      <div class="modalBody">

        <div style="display:grid; gap:10px; padding:12px; border-radius:16px; border:1px solid rgba(0,0,0,0.06);">
          <div style="font-weight:700;">Calibration</div>

          <div style="display:grid; gap:10px;">
            <button class="button" id="btnDry">Calibrate Dry</button>
            <button class="button" id="btnLow">Calibrate Low (e.g. 1413)</button>
            <button class="button" id="btnHigh">Calibrate High (e.g. 12880)</button>
            <button class="button" id="btnClear">Clear Calibration</button>
          </div>

          <input id="ec_value_input" type="number" step="0.1" value="1413" class="button"/>
          <div id="msg" class="mono" style="color:var(--muted-color); font-size:12px;"></div>
        </div>

      </div>
    </div>
  `;

  const msg = overlay.querySelector("#msg");

  function setMsg(s) {
    msg.textContent = s;
  }

  overlay.querySelector("#btnDry").onclick = async () => {
    try {
      setMsg("Working...");
      await post("/api/ec/calibrate", { point: "dry" });
      setMsg("Dry calibration saved.");
    } catch (e) {
      setMsg(e.message);
    }
  };

  overlay.querySelector("#btnLow").onclick = async () => {
    try {
      const v = Number(overlay.querySelector("#ec_value_input").value);
      setMsg("Working...");
      await post("/api/ec/calibrate", { point: "low", value: v });
      setMsg("Low calibration saved.");
    } catch (e) {
      setMsg(e.message);
    }
  };

  overlay.querySelector("#btnHigh").onclick = async () => {
    try {
      const v = Number(overlay.querySelector("#ec_value_input").value);
      setMsg("Working...");
      await post("/api/ec/calibrate", { point: "high", value: v });
      setMsg("High calibration saved.");
    } catch (e) {
      setMsg(e.message);
    }
  };

  overlay.querySelector("#btnClear").onclick = async () => {
    try {
      setMsg("Working...");
      await post("/api/ec/clear", {});
      setMsg("Calibration cleared.");
    } catch (e) {
      setMsg(e.message);
    }
  };

  overlay.querySelector("#close").onclick = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}