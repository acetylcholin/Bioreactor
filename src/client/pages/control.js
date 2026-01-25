async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const FIELDS = [
  "T_Kp", "T_Ki", "T_Kd",
  "Thermostat_MAX_PCT",
  "DO_Kp", "DO_Ki",
  "Stirring_MIN_RPM", "Stirring_MAX_RPM",
  "PH_Kp", "PH_Ki",
  "AcidPump_MIN_MLH", "AcidPump_MAX_MLH",
  "BasePump_MIN_MLH", "BasePump_MAX_MLH",
];

function readForm() {
  const obj = {};
  for (const k of FIELDS) {
    const el = document.getElementById(k);
    const v = el.value;
    obj[k] = (v === "" ? null : Number(v));
  }
  return obj;
}

function writeForm(s) {
  for (const k of FIELDS) {
    const el = document.getElementById(k);
    const v = s?.[k];
    el.value = (v === null || v === undefined) ? "" : String(v);
  }
}

function setMsg(s) {
  document.getElementById("msg").textContent = s || "";
}

async function reload() {
  setMsg("Loading…");
  const data = await getJSON("/api/control/settings");
  writeForm(data.settings || {});
  setMsg(`Loaded. Updated: ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}`);
}

async function save() {
  setMsg("Saving…");
  const settings = readForm();
  await postJSON("/api/control/settings", { settings });
  setMsg("Saved.");
  await reload();
}

document.getElementById("btnReload").addEventListener("click", () => reload().catch(e => setMsg("Error: " + e.message)));
document.getElementById("btnSave").addEventListener("click", () => save().catch(e => setMsg("Error: " + e.message)));

reload().catch(e => setMsg("Error: " + e.message));
