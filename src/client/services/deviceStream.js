export function connectDeviceStream({ onConnection, onDevices }) {
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => onConnection?.("Connected"));
  ws.addEventListener("close", () => onConnection?.("Disconnected"));
  ws.addEventListener("error", () => onConnection?.("Error"));

  ws.addEventListener("message", (msg) => {
    try {
      const payload = JSON.parse(msg.data);
      if (payload.type === "devices") onDevices?.(payload.data);
    } catch (e) {
      console.error("Bad message:", e);
    }
  });

  return ws;
}
