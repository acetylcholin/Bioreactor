import { mountDashboard } from "./pages/dashboard.js";
import { connectDeviceStream } from "./services/deviceStream.js";
import { ProcessPanel } from "./components/ProcessPanel.js";

window.application = window.application || { devices: {} };

function publishDevices(devices) {
  application.devices = devices;
  document.dispatchEvent(new CustomEvent("onupdatedevices", { detail: devices }));
}

mountDashboard(document.getElementById("app"));

connectDeviceStream({
  onConnection: (statusText) => {
    document.dispatchEvent(new CustomEvent("onconnectionchange", { detail: statusText }));
  },
  onDevices: (devices) => publishDevices(devices),
});
