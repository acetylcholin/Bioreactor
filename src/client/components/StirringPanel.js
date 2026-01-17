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

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "ok") return "pill ok";
  if (!s || s === "—") return "pill";
  return "pill bad";
}

export function StirringPanel() {
  const el = document.createElement("section");
  el.className = "tile";

  el.innerHTML = `
    <div class="tileHeader">
      <div class="tileTitle">
        <h2>Stirring</h2>
        <p>PWM • GPIO 19</p>
      </div>
      <div class="tileIcon" title="Stirring">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 3v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M7 9h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M8 21h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M6 21c0-5 3-8 6-8s6 3 6 8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <div class="tileBody">
      <div class="tileValue">
        <div class="num" id="stir_rpm">—</div>
        <div class="unit">RPM</div>
      </div>

      <div class="tileMeta">
        <span class="pill" id="stir_status">—</span>
      </div>
    </div>

    <div class="tileFooter" style="grid-template-columns: 1fr 1fr 110px; align-items:end;">
      <div>
        <div>Device</div>
        <div class="mono" id="stir_id">—</div>
      </div>

      <div style="text-align:left;">
        <div id="stir_time">—</div>
        <div id="stir_error" style="color:#ff8a8a; min-height:14px;"></div>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <input id="stir_input" class="button" type="number" min="0" max="2000" step="10"
               placeholder="RPM" style="width:76px;">
        <button class="tileButton" id="stir_set">Set</button>
      </div>
    </div>
  `;

  const input = el.querySelector("#stir_input");
  const btn = el.querySelector("#stir_set");

  async function sendRPM() {
    const rpm = Number(input.value);
    if (!Number.isFinite(rpm)) return;
    try {
      btn.disabled = true;
      await post("/api/stirring/rpm", { rpm });
    } catch (e) {
      el.querySelector("#stir_error").textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", sendRPM);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendRPM();
  });

  document.addEventListener("onupdatedevices", (event) => {
    const s = (event.detail || {}).stirring || null;

    el.querySelector("#stir_id").textContent = s?.id || "—";
    el.querySelector("#stir_rpm").textContent = (s && s.rpm != null) ? s.rpm : "—";

    const status = s?.status || "—";
    const pill = el.querySelector("#stir_status");
    pill.textContent = status;
    pill.className = statusClass(status);

    const ts = s?.updatedAt ? new Date(s.updatedAt) : null;
    el.querySelector("#stir_time").textContent = ts ? `Updated ${ts.toLocaleTimeString()}` : "—";

    el.querySelector("#stir_error").textContent = s?.error ? s.error : "";
  });

  return el;
}
