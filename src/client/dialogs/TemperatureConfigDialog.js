export function openTemperatureConfigDialog() {
  // Simple modal (no frameworks)
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  overlay.innerHTML = `
    <div class="modal">
      <div class="modalHeader">
        <div class="modalTitle">Configure Temperature Sensor</div>
        <button class="button" id="close">Close</button>
      </div>

      <div class="modalBody">
        <div class="row">
          <div class="label">I2C Bus</div>
          <div class="value">/dev/i2c-1</div>
        </div>
        <div class="row">
          <div class="label">Address</div>
          <div class="value">0x66</div>
        </div>

        <p class="small" style="margin-top:12px;">
          Next step: we’ll load/save config from the server (JSON), and add calibration actions.
        </p>
      </div>
    </div>
  `;

  overlay.querySelector("#close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}
