// src/server/db/db.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB file lives in src/server/db/fermentor.sqlite by default
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "fermentor.sqlite");

function openDb(filename) {
  return new sqlite3.Database(filename);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this); // contains lastID / changes
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function execP(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve(true)));
  });
}

export async function initDb() {
  const db = openDb(DB_PATH);

  // recommended pragmas for Pi
  await run(db, `PRAGMA journal_mode = WAL;`);
  await run(db, `PRAGMA synchronous = NORMAL;`);

  // Batches (one run per batchNumber)
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchNumber TEXT UNIQUE NOT NULL,
      operator TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      createdAt INTEGER NOT NULL,
      startedAt INTEGER,
      stoppedAt INTEGER,
      status TEXT NOT NULL DEFAULT 'IDLE' -- IDLE | RUNNING | STOPPED
    );
  `
  );

  // Settings attached to a batch (history-safe: store multiple versions)
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS batch_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId INTEGER NOT NULL,
      savedAt INTEGER NOT NULL,
      settingsJson TEXT NOT NULL,
      FOREIGN KEY(batchId) REFERENCES batches(id)
    );
  `
  );

  // Templates
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      settingsJson TEXT NOT NULL
    );
  `
  );

  // Sensor log (wide JSON blob for flexibility)
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS sensor_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      snapshotJson TEXT NOT NULL,
      FOREIGN KEY(batchId) REFERENCES batches(id)
    );
  `
  );

  // Control settings (single row id=1)
  await execP(
    db,
    `
    CREATE TABLE IF NOT EXISTS control_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      updatedAt INTEGER NOT NULL,
      settingsJson TEXT NOT NULL
    );
  `
  );

  // Useful indexes
  await run(db, `CREATE INDEX IF NOT EXISTS idx_sensor_log_batch_ts ON sensor_log(batchId, ts);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_batch_settings_batch_time ON batch_settings(batchId, savedAt);`);

  // Seed control_settings row if missing
  const hasControl = await get(db, `SELECT id FROM control_settings WHERE id = 1`);
  if (!hasControl) {
    const defaults = {
      // Temperature PID
      T_Kp: 1.0,
      T_Ki: 0.0,
      T_Kd: 0.0,

      // Thermostat safety limit
      Thermostat_MAX_PCT: 50,

      // DO / stirring PID
      DO_Kp: 1.0,
      DO_Ki: 0.0,

      // stirring limits
      Stirring_MIN_RPM: 200,
      Stirring_MAX_RPM: 1200,

      // pH PID
      PH_Kp: 1.0,
      PH_Ki: 0.0,

      // acid/base limits (mL/h)
      AcidPump_MIN_MLH: 0,
      AcidPump_MAX_MLH: 20,
      BasePump_MIN_MLH: 0,
      BasePump_MAX_MLH: 20,
    };

    await run(
      db,
      `INSERT INTO control_settings(id, updatedAt, settingsJson) VALUES(1, ?, ?)`,
      [Date.now(), JSON.stringify(defaults)]
    );
  }

  // Return wrapper (same shape you already use)
  return {
    db,
    run: (sql, params) => run(db, sql, params),
    get: (sql, params) => get(db, sql, params),
    all: (sql, params) => all(db, sql, params),
    exec: (sql) => execP(db, sql),
  };
}
