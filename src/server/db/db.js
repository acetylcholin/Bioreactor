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

export async function initDb() {
  const db = openDb(DB_PATH);

  // recommended pragmas for Pi
  await run(db, `PRAGMA journal_mode = WAL;`);
  await run(db, `PRAGMA synchronous = NORMAL;`);

  // Batches (one run per batchNumber)
  await run(db, `
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
  `);

  // Settings attached to a batch (history-safe: store multiple versions)
  await run(db, `
    CREATE TABLE IF NOT EXISTS batch_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId INTEGER NOT NULL,
      savedAt INTEGER NOT NULL,
      settingsJson TEXT NOT NULL,
      FOREIGN KEY(batchId) REFERENCES batches(id)
    );
  `);

  // Templates
  await run(db, `
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      settingsJson TEXT NOT NULL
    );
  `);

  // Sensor log (wide JSON blob for flexibility)
  await run(db, `
    CREATE TABLE IF NOT EXISTS sensor_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      snapshotJson TEXT NOT NULL,
      FOREIGN KEY(batchId) REFERENCES batches(id)
    );
  `);

  // Useful indexes
  await run(db, `CREATE INDEX IF NOT EXISTS idx_sensor_log_batch_ts ON sensor_log(batchId, ts);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_batch_settings_batch_time ON batch_settings(batchId, savedAt);`);

  return { db, run: (s, p) => run(db, s, p), get: (s, p) => get(db, s, p), all: (s, p) => all(db, s, p) };
}
