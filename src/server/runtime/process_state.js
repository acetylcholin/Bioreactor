// ---- Fermentation process state (in-memory mirror)
export const processState = {
  phase: "IDLE", // IDLE | PREPARING | RUNNING
  running: false,
  controlEnabled: false,
  t0: null,
  readyToInoculate: false,
  stableTemp: false,
  settings: {
    batchNumber: "",
    operator: "",
    notes: "",

    targetTempC: "",
    targetPh: "",
    phDeadband: "0.05",
    feedMlh: "",

    targetDoPct: "",
    airFlowMlMin: "",
  },
};