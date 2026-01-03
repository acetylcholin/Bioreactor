export function openPhConfigDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  overlay.innerHTML = `
    <div class="modal">
      <div class="modalHeader">
        <div class="modalTitle">Configure pH Sensor</div>
        <button class="button" id="close">Close</button>
      </div>
      <div class="modalBody">
        <div>Address: <b>0x63</b></div>
        <div>Bus: <b>/dev/i2c-1</b></div>
        <p style="margin-top:10px;">Next: calibration buttons (pH 4 / 7 / 10) + store settings.</p>
      </div>
    </div>
  `;

  overlay.querySelector("#close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  document.body.appendChild(overlay);
}
