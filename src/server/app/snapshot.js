import { processState } from "../runtime/process_state.js";

function safeErrorMessage(e) {
  return e && e.message ? e.message : String(e);
}

/**
 * Build a snapshot that never crashes if a device is missing/failed.
 */
export function buildDevicesSnapshot(ezortd, ezoph, thermostat, pumpBoard, stirring, illumination) {
  const devices = {};

  if (ezortd) {
    try {
      const j = ezortd.toJSON();
      if (ezortd.error && !j.error) j.error = ezortd.error;
      devices.ezortdSensor = j;
    } catch (e) {
      devices.ezortdSensor = { id: "ezortdSensor", status: "failed", value: null, unit: "°C", error: safeErrorMessage(e), updatedAt: Date.now() };
    }
  }

  if (ezoph) {
    try {
      const j = ezoph.toJSON();
      if (ezoph.error && !j.error) j.error = ezoph.error;
      devices.ezophSensor = j;
    } catch (e) {
      devices.ezophSensor = { id: "ezophSensor", status: "failed", value: null, unit: "pH", error: safeErrorMessage(e), updatedAt: Date.now() };
    }
  }

  if (thermostat) {
    try {
      const j = thermostat.toJSON();
      if (thermostat.error && !j.error) j.error = thermostat.error;
      devices.thermostat = j;
    } catch (e) {
      devices.thermostat = { id: "thermostat", status: "failed", mode: 0, percentage: 0, voltage: null, current: null, power: null, error: safeErrorMessage(e), updatedAt: Date.now() };
    }
  }

  if (pumpBoard) {
    try {
      const j = pumpBoard.toJSON();
      if (pumpBoard.error && !j.error) j.error = pumpBoard.error;
      if (pumpBoard.status && !j.status) j.status = pumpBoard.status;
      devices.pumps = j;
    } catch (e) {
      devices.pumps = { id: "-", status: "failed", address: "0x10", error: safeErrorMessage(e), pumps: {}, updatedAt: Date.now() };
    }
  }

  if (stirring) {
    try {
      const j = stirring.toJSON();
      if (stirring.error && !j.error) j.error = stirring.error;
      devices.stirring = j;
    } catch (e) {
      devices.stirring = { id: "stirring", status: "failed", rpm: 0, unit: "RPM", gpioPin: 19, error: safeErrorMessage(e), updatedAt: Date.now() };
    }
  }

  if (illumination) {
    try {
      const j = illumination.toJSON();
      if (illumination.error && !j.error) j.error = illumination.error;
      devices.illumination = j;
    } catch (e) {
      devices.illumination = { id: "illumination", status: "failed", rgb: "#000000", error: safeErrorMessage(e), updatedAt: Date.now() };
    }
  }

  devices.process = {
    phase: processState.phase,
    running: processState.running,
    controlEnabled: processState.controlEnabled,
    t0: processState.t0,
    readyToInoculate: processState.readyToInoculate,
    stableTemp: processState.stableTemp,
    settings: processState.settings,
  };

  return devices;
}