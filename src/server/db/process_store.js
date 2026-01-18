// src/server/db/process_store.js
export async function ensureBatch(db, batchNumber, operator = "", notes = "") {
  const now = Date.now();
  const existing = await db.get(`SELECT * FROM batches WHERE batchNumber = ?`, [batchNumber]);
  if (existing) {
    // update operator/notes if provided
    if (operator || notes) {
      await db.run(
        `UPDATE batches SET operator = COALESCE(NULLIF(?,''), operator),
                            notes    = COALESCE(NULLIF(?,''), notes)
         WHERE id = ?`,
        [operator || "", notes || "", existing.id]
      );
    }
    return await db.get(`SELECT * FROM batches WHERE id = ?`, [existing.id]);
  }

  const ins = await db.run(
    `INSERT INTO batches(batchNumber, operator, notes, createdAt, status)
     VALUES(?,?,?,?, 'IDLE')`,
    [batchNumber, operator || "", notes || "", now]
  );
  return await db.get(`SELECT * FROM batches WHERE id = ?`, [ins.lastID]);
}

export async function saveBatchSettings(db, batchId, settingsObj) {
  const now = Date.now();
  await db.run(
    `INSERT INTO batch_settings(batchId, savedAt, settingsJson) VALUES(?,?,?)`,
    [batchId, now, JSON.stringify(settingsObj)]
  );
}

export async function getLatestSettings(db, batchId) {
  const row = await db.get(
    `SELECT settingsJson FROM batch_settings WHERE batchId = ? ORDER BY savedAt DESC LIMIT 1`,
    [batchId]
  );
  return row ? JSON.parse(row.settingsJson) : null;
}

export async function startBatch(db, batchId) {
  const now = Date.now();
  await db.run(
    `UPDATE batches SET status='RUNNING', startedAt=COALESCE(startedAt, ?), stoppedAt=NULL WHERE id=?`,
    [now, batchId]
  );
  return now;
}

export async function stopBatch(db, batchId) {
  const now = Date.now();
  await db.run(
    `UPDATE batches SET status='STOPPED', stoppedAt=? WHERE id=?`,
    [now, batchId]
  );
  return now;
}

export async function logSnapshot(db, batchId, snapshotObj) {
  const now = Date.now();
  await db.run(
    `INSERT INTO sensor_log(batchId, ts, snapshotJson) VALUES(?,?,?)`,
    [batchId, now, JSON.stringify(snapshotObj)]
  );
}
