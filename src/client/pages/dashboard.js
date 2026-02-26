// src/client/pages/dashboard.js
import { TemperaturePanel } from "../components/TemperaturePanel.js";
import { PhPanel } from "../components/PhPanel.js";
import { ThermostatPanel } from "../components/ThermostatPanel.js";
import { PumpPanel } from "../components/PumpPanel.js";
import { ProcessPanel } from "../components/ProcessPanel.js";
import { StirringPanel } from "../components/StirringPanel.js";
import { IlluminationPanel } from "../components/IlluminationPanel.js";

export function mountDashboard(rootEl) {
  rootEl.innerHTML = `
    <div class="header">
      <div class="headerInner">
        <div class="titleWrap">
          <h1 class="title">Fermentor</h1>
          <p class="subtitle">
  Live process dashboard
  <span id="remoteIndicator" class="remote-indicator hidden">
    • Remote connected
  </span>
</p>
        </div>

        <div class="headerActions" aria-label="Dashboard actions">
          <button class="tileButton" id="openCam" type="button">Fermentor Live</button>
          <a class="tileButton" href="/viz.html" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">Visualization</a>
          <a class="tileButton" href="/db_admin.html" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">DB Admin</a>
          <a class="tileButton" href="/control.html" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">Control settings</a>
          <div id="conn" class="badge">Connecting…</div>
        </div>
      </div>

      <!-- ✅ Process Control is now part of the header -->
      <div class="headerProcess">
        <div class="headerProcessTitle">Process Control</div>
        <div id="process"></div>
      </div>
    </div>

    <div class="main">
      <section class="tilesSection">
        <div id="grid" class="tiles"></div>
      </section>
    </div>
  `;

// ==============================
// ✅ Smooth scroll-driven header (transform-only, NO LAYOUT JANK)
// ✅ 1:1 scroll-follow (no lag, no "under then jump")
// ==============================

// cleanup if dashboard remounts
if (window.__dashSmoothCleanup) {
  window.__dashSmoothCleanup();
  window.__dashSmoothCleanup = null;
}

const MOBILE_MAX = 760;
const headerEl = document.querySelector(".header");

const START = 40;    // scroll where hide starts
const END = 200;     // scroll where hide completes

const PAD_MIN = 18;  // minimum top space when header is gone
const GAP = 1;      // gap under header when visible

let headerH = 120;
let MAX_HIDE = 140;
let PAD_OPEN = 160;

function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

function isMobile(){
  return window.matchMedia(`(max-width: ${MOBILE_MAX}px)`).matches;
}

function measure(){
  // IMPORTANT: measure after header content is in DOM
  headerH = (headerEl?.offsetHeight || 120);
  MAX_HIDE = headerH + 24;     // fully out of screen
  PAD_OPEN = headerH + GAP;    // content starts under header
  document.documentElement.style.setProperty("--padOpen", `${PAD_OPEN}px`);
}

function applyFromScrollY(y){
  if (!isMobile()){
    document.documentElement.style.setProperty("--hdrY", `0px`);
    return;
  }

  const t = clamp01((y - START) / (END - START));
  const e = easeOutCubic(t);

  // header slides up
  const hdrY = -MAX_HIDE * e;

  document.documentElement.style.setProperty("--hdrY", `${hdrY}px`);
}

// rAF throttling (smooth but no lag)
let latestY = window.scrollY;
let ticking = false;

function onScroll(){
  latestY = window.scrollY;
  if (!ticking){
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      applyFromScrollY(latestY);
    });
  }
}

function onResize(){
  // resize/orientation changes can change header height (wrap!)
  measure();
  applyFromScrollY(window.scrollY);
}

// ✅ INIT: delay measuring to next frame so header height is correct
function initAfterLayout(){
  measure();
  applyFromScrollY(window.scrollY);

  // ✅ safety: one more frame later (fonts/wrap can settle)
  requestAnimationFrame(() => {
    measure();
    applyFromScrollY(window.scrollY);
  });
}

// listeners
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onResize, { passive: true });

// run init after layout
requestAnimationFrame(initAfterLayout);

window.__dashSmoothCleanup = () => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onResize);

  document.documentElement.style.removeProperty("--hdrY");
 
  document.documentElement.style.removeProperty("--padOpen");
};
  /* ==========================================
     Panels
     ========================================== */

  const grid = rootEl.querySelector("#grid");
  const process = rootEl.querySelector("#process");

  // ✅ now mounts into headerProcess
  process.appendChild(ProcessPanel());

  grid.appendChild(TemperaturePanel());
  grid.appendChild(PhPanel());
  grid.appendChild(ThermostatPanel());
  grid.appendChild(PumpPanel());
  grid.appendChild(StirringPanel());
  grid.appendChild(IlluminationPanel());

  document.addEventListener("onconnectionchange", (e) => {
    const el = rootEl.querySelector("#conn");
    if (el) el.textContent = e.detail;
  });

  rootEl.querySelector("#openCam").addEventListener("click", openCameraOverlay);
}

/* =========================================================
   📷 Fermentor Live Overlay (iframe-based)
   ========================================================= */
function openCameraOverlay() {
  const overlay = document.createElement("div");

  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.65)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "10000";
  overlay.style.backdropFilter = "blur(4px)";

  overlay.innerHTML = `
    <div style="
      width: min(1100px, 95vw);
      height: min(750px, 92vh);
      background: rgba(18,18,22,.98);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 18px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,.6);
    ">
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      ">
        <div>
          <div style="font-weight:800; font-size:16px;">Fermentor Live</div>
          <div style="opacity:.7; font-size:12px;">Logitech C270 — Live Stream</div>
        </div>

        <div style="display:flex; gap:10px;">
          <button id="reloadCam" class="tileButton" type="button">Reload</button>
          <button id="closeCam" class="tileButton" type="button">Close</button>
        </div>
      </div>

      <div id="frameHost" style="flex:1; padding: 12px;"></div>
    </div>
  `;

  const frameHost = overlay.querySelector("#frameHost");

  function makeFrame() {
    const frame = document.createElement("iframe");
    frame.src = "/cam.html?ts=" + Date.now();
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "none";
    frame.style.borderRadius = "14px";
    frame.style.background = "rgba(0,0,0,.35)";
    frame.setAttribute("allow", "autoplay");
    return frame;
  }

  let frame = makeFrame();
  frameHost.appendChild(frame);

  function close() {
    try { frame.remove(); } catch {}
    overlay.remove();
  }

  overlay.querySelector("#closeCam").addEventListener("click", close);
  overlay.querySelector("#reloadCam").addEventListener("click", () => {
    try { frame.remove(); } catch {}
    frame = makeFrame();
    frameHost.appendChild(frame);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const onKey = (e) => {
    if (e.key === "Escape") {
      document.removeEventListener("keydown", onKey);
      close();
    }
  };
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
}
// ==============================
// 🌍 Remote (Tailscale) indicator
// ==============================
async function updateRemoteIndicator() {
  try {
    const res = await fetch("/api/remote-status", { cache: "no-store" });
    const data = await res.json();

    const el = document.getElementById("remoteIndicator");
    if (!el) return;

    if (data.remoteConnected) {
      el.textContent = `• Remote connected (${data.remoteCount})`;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  } catch {
    // network hiccup → ignore
  }
}

// poll every 5 seconds
updateRemoteIndicator();
setInterval(updateRemoteIndicator, 5000);