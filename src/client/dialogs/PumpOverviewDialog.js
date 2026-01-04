function fmt(v, suffix = "") {
  return (v == null) ? "—" : `${v}${suffix}`;
}

export function openPumpOverviewDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  overlay.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <div class="modalHeader">
        <div class="modalTitle">All Pumps Overview</div>
        <button class="button" id="close">Close</button>
      </div>

      <div class="modalBody">
        <div style="overflow:auto;">
          <table style="width:100%; border-collapse:collapse;">
            <thead>
              <tr style="text-align:left; color: var(--muted-color); font-size:12px;">
                <th style="padding:8px;">Pump</th>
                <th style="padding:8px;">RPM</th>
                <th style="padding:8px;">mL/h</th>
                <th style="padding:8px;">Sum mL</th>
                <th style="padding:8px;">Status</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
        <div id="err" style="color:#ff8a8a; margin-top:10px;"></div>
      </div>
    </div>
  `;

  function render(devices) {
    const board = devices && devices.pumps;
    const pumps = board && board.pumps ? board.pumps : null;
    const rows = overlay.querySelector("#rows");
    rows.innerHTML = "";

    if (!pumps) {
      overlay.querySelector("#err").textContent = "No pump data yet.";
      return;
    }

    overlay.querySelector("#err").textContent = "";

    const order = ["acid", "base", "antifoam", "feed"];
    for (const key of order) {
      const p = pumps[key] || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="padding:8px; font-weight:600;">${key}</td>
        <td style="padding:8px;" class="mono">${fmt(p.rpm)}</td>
        <td style="padding:8px;" class="mono">${fmt(p.mlh)}</td>
        <td style="padding:8px;" class="mono">${fmt(p.sumML)}</td>
        <td style="padding:8px;">${p.status || "—"}</td>
      `;
      rows.appendChild(tr);
    }
  }

  // initial paint from last snapshot if we have it
  render((window.application && window.application.devices) ? window.application.devices : null);

  // live updates while dialog is open
  const handler = (event) => render(event.detail || {});
  document.addEventListener("onupdatedevices", handler);

  overlay.querySelector("#close").addEventListener("click", () => {
    document.removeEventListener("onupdatedevices", handler);
    overlay.remove();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      document.removeEventListener("onupdatedevices", handler);
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}
