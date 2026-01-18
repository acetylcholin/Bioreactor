async function postSettings(settings) {
  await fetch("/api/illumination/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function openIlluminationConfigDialog() {
  const cur = (window.application?.devices?.illumination?.settings) || {
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

  const intensityEl = overlay.querySelector("#intensity");
  const ivalEl = overlay.querySelector("#ival");
  intensityEl.addEventListener("input", () => { ivalEl.textContent = intensityEl.value; });

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
      // simple error feedback
      alert("Failed to save illumination settings.");
    }
  });

  document.body.appendChild(overlay);
}
