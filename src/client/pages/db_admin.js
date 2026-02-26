// src/client/db_admin.js  (or /pages/db_admin.js if you update the HTML src)
// DB Admin UI - uses server routes mounted by mountDbAdminRoutes()

function $(sel) { return document.querySelector(sel); }

function esc(s) {
  const str = s === null || s === undefined ? "" : String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function fmtTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Date(n).toLocaleString();
}

function setStatus(text) {
  const el = $("#status");
  if (el) el.textContent = text;
}

async function apiJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });

  let data = null;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok || (data && data.ok === false)) {
    const msg = (data && data.error) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

function pill(text) {
  // Reuse your existing "badge" look
  return `<span class="badge">${esc(text)}</span>`;
}

function statusPill(status) {
  const s = String(status || "—");
  return pill(s);
}

function renderSummary(summary) {
  const el = $("#summary");
  if (!el) return;

  const c = summary?.counts || {};
  const last = summary?.last || {};

  el.innerHTML = `
    <div class="tiles">
      <div class="tile">
        <div class="tileHeader">
          <div class="tileTitle">DB File</div>
        </div>
        <div class="tileBody">
          <div style="opacity:.85; font-size:12px; word-break:break-all;">${esc(summary?.dbFile ?? "—")}</div>
          <div style="margin-top:8px;">Size: <b>${esc(fmtBytes(summary?.fileSizeBytes))}</b></div>
        </div>
      </div>

      <div class="tile">
        <div class="tileHeader">
          <div class="tileTitle">Counts</div>
        </div>
        <div class="tileBody" style="display:grid; gap:6px;">
          <div>Batches: <b>${esc(c.batches ?? 0)}</b></div>
          <div>sensor_log rows: <b>${esc(c.sensor_log ?? 0)}</b></div>
          <div>batch_static rows: <b>${esc(c.batch_static ?? 0)}</b></div>
          <div>templates: <b>${esc(c.templates ?? 0)}</b></div>
        </div>
      </div>

      <div class="tile">
        <div class="tileHeader">
          <div class="tileTitle">Last activity</div>
        </div>
        <div class="tileBody" style="display:grid; gap:6px;">
          <div>Last batch id: <b>${esc(last.lastBatchId ?? "—")}</b></div>
          <div>Last log: <b>${esc(fmtTs(last.lastLogTs))}</b></div>
        </div>
      </div>

      <div class="tile">
        <div class="tileHeader">
          <div class="tileTitle">Stored data</div>
        </div>
        <div class="tileBody" style="font-size:12px; opacity:.9; line-height:1.35;">
          <div><b>batches</b>: metadata (status, times, operator, notes)</div>
          <div style="margin-top:6px;"><b>sensor_log</b>: dynamic snapshotJson (time-series)</div>
          <div style="margin-top:6px;"><b>batch_static</b>: staticJson once per batch</div>
          <div style="margin-top:6px;"><b>templates</b>: settingsJson presets</div>
        </div>
      </div>
    </div>
  `;
}

function renderBatches(rows) {
  const el = $("#batches");
  if (!el) return;

  const list = Array.isArray(rows) ? rows : [];

  if (list.length === 0) {
    el.innerHTML = `<div class="tile"><div class="tileBody">No batches found.</div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="tiles">
      ${list.map(b => {
        const id = b.id;
        const st = String(b.status || "—").toUpperCase();
        const disableDelete = (st === "RUNNING" || st === "PREPARING");

        return `
          <div class="tile">
            <div class="tileHeader" style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
              <div>
                <div class="tileTitle">#${esc(id)} — ${esc(b.batchNumber || "")}</div>
                <div style="margin-top:6px;">${statusPill(b.status || "—")}</div>
              </div>
              <button class="tileButton" data-del="${esc(id)}" ${disableDelete ? "disabled" : ""}>
                Delete
              </button>
            </div>

            <div class="tileBody" style="display:grid; gap:6px; font-size:13px;">
              <div><b>Created:</b> ${esc(fmtTs(b.createdAt))}</div>
              <div><b>Started:</b> ${esc(fmtTs(b.startedAt))}</div>
              <div><b>Inoculated:</b> ${esc(fmtTs(b.inoculatedAt))}</div>
              <div><b>Stopped:</b> ${esc(fmtTs(b.stoppedAt))}</div>
              <div style="margin-top:6px; display:flex; justify-content:space-between; gap:10px;">
                <div><b>Points:</b> ${esc(b.points ?? 0)}</div>
                <div><b>Approx size:</b> ${esc(fmtBytes(b.approxBytes ?? 0))}</div>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  el.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!id) return;

      const ok = confirm(
        `Delete batch #${id}?\n\nThis will delete:\n- sensor_log rows\n- batch_static rows\n- the batch row\n\nCannot be undone.`
      );
      if (!ok) return;

      btn.disabled = true;
      setStatus(`Deleting #${id}…`);

      try {
        await apiJson(`/api/db/batches/${encodeURIComponent(id)}`, { method: "DELETE" });
        setStatus(`Deleted #${id}`);
        await refreshAll();
      } catch (e) {
        setStatus(`Delete failed: ${e.message}`);
        btn.disabled = false;
      }
    });
  });
}

async function refreshAll() {
  setStatus("Refreshing…");
  const summary = await apiJson("/api/db/summary");
  renderSummary(summary);

  const batches = await apiJson("/api/db/batches?limit=200");
  renderBatches(batches?.batches || []);

  setStatus("Ready");
}

async function runVacuum() {
  const ok = confirm("Run VACUUM? This can take time and locks the DB while running.");
  if (!ok) return;
  setStatus("VACUUM running…");
  await apiJson("/api/db/vacuum", { method: "POST", body: "{}" });
  setStatus("VACUUM finished");
  await refreshAll();
}

async function runIntegrity() {
  setStatus("Integrity check…");
  const out = await apiJson("/api/db/integrity");
  const r = out?.result?.integrity_check || out?.result?.["integrity_check"] || JSON.stringify(out?.result || {});
  alert(`Integrity check result:\n\n${r}`);
  setStatus(String(r).toLowerCase() === "ok" ? "Integrity: OK" : "Integrity: NOT OK");
}

function wireButtons() {
  $("#refresh")?.addEventListener("click", () => refreshAll().catch(e => setStatus(`Refresh failed: ${e.message}`)));
  $("#vacuum")?.addEventListener("click", () => runVacuum().catch(e => setStatus(`VACUUM failed: ${e.message}`)));
  $("#integrity")?.addEventListener("click", () => runIntegrity().catch(e => setStatus(`Integrity failed: ${e.message}`)));
}

(function boot() {
  wireButtons();
  refreshAll().catch((e) => {
    // If this triggers, 99%: server routes not mounted OR wrong script path
    setStatus(`Error: ${e.message}`);
    const summaryEl = $("#summary");
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="tile">
          <div class="tileBody">
            <b>DB Admin cannot load data.</b><br/>
            Error: ${esc(e.message)}<br/><br/>
            Check:
            <ul>
              <li>server main.js mounts mountDbAdminRoutes()</li>
              <li>db_admin.html script src points to the correct JS path</li>
            </ul>
          </div>
        </div>
      `;
    }
  });
})();