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

function nowMs() { return Date.now(); }

function formatSeconds(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function openPumpConfigDialog(initialType = "acid") {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  let calibRunning = false;
  let calibStartMs = 0;
  let timerId = null;

  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <div class="modalHeader">
        <div class="modalTitle">Configure Pump</div>
        <button class="button" id="close">Close</button>
      </div>

      <div class="modalBody">
        <div style="display:grid; gap:16px;">

          <!-- Basic control -->
          <div style="display:grid; gap:12px; padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:16px;">
            <div style="font-weight:700;">Setpoints</div>

            <label>
              <div style="color: var(--muted-color); font-size:12px;">Pump</div>
              <select id="type" class="button" style="width:100%;">
                <option value="acid">Acid</option>
                <option value="base">Base</option>
                <option value="antifoam">Antifoam</option>
                <option value="feed">Feed</option>
              </select>
            </label>

            <label>
              <div style="color: var(--muted-color); font-size:12px;">Target flow (mL/h)</div>
              <input id="mlh" class="button" type="number" min="0" max="9999" step="1" value="0" style="width:100%;"/>
              <div style="color: var(--muted-color); font-size:12px; margin-top:6px;">
                Tip: this is the normal operator control. The firmware uses calibration to convert to RPM.
              </div>
            </label>

            <div style="display:flex; gap:10px; justify-content:flex-end;">
              <button class="button" id="stop">Stop</button>
              <button class="button" id="apply">Apply</button>
              <button class="button" id="clearSum">Clear Sum</button>
            </div>
          </div>

          <!-- Calibration workflow -->
          <div style="display:grid; gap:12px; padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:16px;">
            <div style="font-weight:700;">Calibration (easy)</div>

            <div style="color: var(--muted-color); font-size:12px; line-height:1.4;">
              1) Set a calibration RPM (e.g. 10).<br/>
              2) Press <b>Start</b> (pump runs, timer starts).<br/>
              3) When done, measure pumped water mass (grams). For water: <b>1 g ≈ 1 mL</b>.<br/>
              4) Enter grams and press <b>Finish</b>. We calculate mL/h and store calibration on the pump board.
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <label>
                <div style="color: var(--muted-color); font-size:12px;">Calibration RPM</div>
                <input id="calRpm" class="button" type="number" min="0" max="50" step="1" value="10" style="width:100%;"/>
              </label>

              <label>
                <div style="color: var(--muted-color); font-size:12px;">Measured grams (g)</div>
                <input id="grams" class="button" type="number" min="0" step="0.1" value="0" style="width:100%;"/>
              </label>
            </div>

            <div style="display:flex; gap:10px; align-items:center; justify-content:space-between;">
              <div class="mono">
                Time: <span id="timer">00:00</span>
              </div>

              <div style="display:flex; gap:10px;">
                <button class="button" id="calStart">Start</button>
                <button class="button" id="calFinish">Finish</button>
              </div>
            </div>

            <div id="calResult" class="mono" style="color: var(--muted-color); font-size:12px;"></div>
          </div>

          <div id="msg" style="color: var(--muted-color); font-size:12px;"></div>
        </div>
      </div>
    </div>
  `;

  const typeSel = overlay.querySelector("#type");
  typeSel.value = initialType;

  function selectedType() {
    return typeSel.value;
  }

  function setMsg(s) {
    overlay.querySelector("#msg").textContent = s || "";
  }

  function setCalResult(s) {
    overlay.querySelector("#calResult").textContent = s || "";
  }

  function setTimerText() {
    const sec = calibRunning ? (nowMs() - calibStartMs) / 1000 : 0;
    overlay.querySelector("#timer").textContent = formatSeconds(sec);
  }

  async function stopPump(type) {
    await post(`/api/pumps/${type}/rpm`, { rpm: 0 });
    await post(`/api/pumps/${type}/mlh`, { mlh: 0 });
  }

  // --- Apply setpoints
  overlay.querySelector("#apply").addEventListener("click", async () => {
    setMsg("");
    try {
      const type = selectedType();
      const mlh = Number(overlay.querySelector("#mlh").value);
      await post(`/api/pumps/${type}/mlh`, { mlh });
      setMsg("Saved target mL/h.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  overlay.querySelector("#stop").addEventListener("click", async () => {
    setMsg("");
    try {
      await stopPump(selectedType());
      setMsg("Stopped.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  overlay.querySelector("#clearSum").addEventListener("click", async () => {
    setMsg("");
    try {
      await post(`/api/pumps/${selectedType()}/clearsum`, {});
      setMsg("Sum cleared.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  // --- Calibration start
  overlay.querySelector("#calStart").addEventListener("click", async () => {
    setMsg("");
    setCalResult("");

    try {
      const type = selectedType();
      const rpm = Number(overlay.querySelector("#calRpm").value);

      // Start pump at calibration RPM
      await post(`/api/pumps/${type}/rpm`, { rpm });

      calibRunning = true;
      calibStartMs = nowMs();
      setTimerText();

      if (timerId) clearInterval(timerId);
      timerId = setInterval(setTimerText, 250);

      setMsg(`Calibration started at ${rpm} RPM. Measure time + grams, then press Finish.`);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  // --- Calibration finish: compute mlh and store to board
  overlay.querySelector("#calFinish").addEventListener("click", async () => {
    setMsg("");
    setCalResult("");

    try {
      if (!calibRunning) {
        setMsg("Calibration is not running. Press Start first.");
        return;
      }

      const type = selectedType();
      const rpm = Number(overlay.querySelector("#calRpm").value);
      const grams = Number(overlay.querySelector("#grams").value);

      const seconds = Math.max(1, Math.round((nowMs() - calibStartMs) / 1000));
      calibRunning = false;
      if (timerId) { clearInterval(timerId); timerId = null; }

      // For water: 1 g ≈ 1 mL
      const ml = grams; // mL
      const mlh = (ml * 3600) / seconds;

      // Store calibration on hardware (server will call SetCal{pumpid},rpm,mlh)
      await post(`/api/pumps/${type}/calibrate`, { rpm, mlh: Math.round(mlh) });

      // Optional: stop pump after calibration
      await stopPump(type);

      setCalResult(`Calculated: ${ml.toFixed(1)} mL in ${seconds}s → ${mlh.toFixed(0)} mL/h. Stored to board.`);
      setMsg("Calibration saved to pump board.");
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
  });

  // Close cleanup
  function close() {
    if (timerId) clearInterval(timerId);
    overlay.remove();
  }

  overlay.querySelector("#close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  document.body.appendChild(overlay);
}
