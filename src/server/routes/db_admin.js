// src/server/routes/db_admin.js
import fs from "node:fs/promises";
import path from "path";

/**
 * DB Admin routes (dangerous ops: delete, vacuum).
 *
 * Usage in main.js:
 *   import { mountDbAdminRoutes } from "./routes/db_admin.js";
 *   mountDbAdminRoutes(app, { db, runDbExclusive, processState, getActiveBatchId: () => activeBatchId, baseDir: __dirname });
 */
export function mountDbAdminRoutes(app, opts) {
  const { db, runDbExclusive, processState, getActiveBatchId, baseDir } = opts;

  function safeErrorMessage(e) {
    return e && e.message ? e.message : String(e);
  }

  // Try to locate sqlite file. If your initDb uses another path, adjust this.
  const DB_FILE = path.resolve(baseDir, "./db/fermentor.sqlite");

  // ---- DB summary: file size + key table counts
  app.get("/api/db/summary", async (req, res) => {
    try {
      let fileSizeBytes = null;
      try {
        const st = await fs.stat(DB_FILE);
        fileSizeBytes = st.size;
      } catch {
        fileSizeBytes = null;
      }

      const [batches, logs, statics, settings, templates] = await Promise.all([
        db.get(`SELECT COUNT(*) as n FROM batches`),
        db.get(`SELECT COUNT(*) as n FROM sensor_log`),
        db.get(`SELECT COUNT(*) as n FROM batch_static`),
        db.get(`SELECT COUNT(*) as n FROM batch_settings`),
        db.get(`SELECT COUNT(*) as n FROM templates`),
      ]);

      const lastLog = await db.get(`SELECT MAX(ts) as ts FROM sensor_log`);
      const lastBatch = await db.get(`SELECT MAX(id) as id FROM batches`);

      res.json({
        ok: true,
        dbFile: DB_FILE,
        fileSizeBytes,
        counts: {
          batches: batches?.n ?? 0,
          batch_settings: settings?.n ?? 0,
          sensor_log: logs?.n ?? 0,
          batch_static: statics?.n ?? 0,
          templates: templates?.n ?? 0,
        },
        last: {
          lastBatchId: lastBatch?.id ?? null,
          lastLogTs: lastLog?.ts ?? null,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // ---- Batch admin list with log statistics
  // Includes: count points, first/last ts, approx bytes of snapshotJson
  app.get("/api/db/batches", async (req, res) => {
    try {
      const limit = Math.max(10, Math.min(500, Number(req.query.limit) || 200));

      const rows = await db.all(
        `
        SELECT
          b.id, b.batchNumber, b.operator, b.notes, b.status,
          b.createdAt, b.startedAt, b.inoculatedAt, b.stoppedAt,

          COALESCE(l.points, 0) as points,
          l.firstTs as firstTs,
          l.lastTs as lastTs,
          COALESCE(l.bytes, 0) as approxBytes
        FROM batches b
        LEFT JOIN (
          SELECT
            batchId,
            COUNT(*) as points,
            MIN(ts) as firstTs,
            MAX(ts) as lastTs,
            SUM(LENGTH(snapshotJson)) as bytes
          FROM sensor_log
          GROUP BY batchId
        ) l ON l.batchId = b.id
        ORDER BY b.id DESC
        LIMIT ?
        `,
        [limit]
      );

      res.json({ ok: true, batches: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // ---- Delete a batch (and its dependent rows)
  app.delete("/api/db/batches/:id(\\d+)", async (req, res) => {
    const batchId = Number(req.params.id);

    try {
      // Safety: don’t delete active batch
      const activeBatchId = getActiveBatchId?.() ?? null;
      if (activeBatchId && batchId === activeBatchId) {
        throw new Error("Refusing to delete active batch. Stop process first.");
      }

      // Safety: don’t delete RUNNING/PREPARING
      const b = await db.get(`SELECT id, status FROM batches WHERE id = ?`, [batchId]);
      if (!b) return res.status(404).json({ ok: false, error: "Batch not found" });

      const st = String(b.status || "").toUpperCase();
      if (st === "RUNNING" || st === "PREPARING") {
        throw new Error("Refusing to delete batch with status RUNNING/PREPARING. Stop it first.");
      }

      const result = await runDbExclusive(async () => {
        await db.exec("BEGIN");
        try {
          // ✅ IMPORTANT: delete children first to satisfy FK constraints
          const rSettings = await db.run(`DELETE FROM batch_settings WHERE batchId = ?`, [batchId]);
          const rLog = await db.run(`DELETE FROM sensor_log WHERE batchId = ?`, [batchId]);
          const rStatic = await db.run(`DELETE FROM batch_static WHERE batchId = ?`, [batchId]);

          const rBatch = await db.run(`DELETE FROM batches WHERE id = ?`, [batchId]);

          await db.exec("COMMIT");

          return {
            batch_settings_deleted: rSettings?.changes ?? 0,
            sensor_log_deleted: rLog?.changes ?? 0,
            batch_static_deleted: rStatic?.changes ?? 0,
            batches_deleted: rBatch?.changes ?? 0,
          };
        } catch (e) {
          try {
            await db.exec("ROLLBACK");
          } catch {}
          throw e;
        }
      });

      res.json({ ok: true, deleted: result });
    } catch (e) {
      console.error("DB_ADMIN DELETE failed:", {
        batchId,
        message: e?.message,
        code: e?.code,
        errno: e?.errno,
        stack: e?.stack,
      });

      res.status(500).json({
        ok: false,
        error: e?.message ? e.message : String(e),
        code: e?.code ?? null,
      });
    }
  });

  // ---- Find which tables reference a given batchId (debug FK constraint failures)
  app.get("/api/db/batches/:id(\\d+)/refs", async (req, res) => {
    try {
      const batchId = Number(req.params.id);

      const fkTables = await db.all(`
        SELECT m.name AS tableName
        FROM sqlite_master m
        WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'
      `);

      const results = [];

      for (const t of fkTables) {
        const fks = await db.all(`PRAGMA foreign_key_list(${t.tableName})`);
        const refsBatches = (fks || []).some((fk) => fk.table === "batches");
        if (!refsBatches) continue;

        const cols = await db.all(`PRAGMA table_info(${t.tableName})`);
        const hasBatchId = (cols || []).some((c) => c.name === "batchId");
        if (!hasBatchId) continue;

        const row = await db.get(
          `SELECT COUNT(*) AS n FROM ${t.tableName} WHERE batchId = ?`,
          [batchId]
        );

        results.push({ table: t.tableName, rows: row?.n ?? 0 });
      }

      res.json({ ok: true, batchId, refs: results.filter((r) => r.rows > 0) });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // ---- Vacuum (reclaims file space). Use after deletions.
  app.post("/api/db/vacuum", async (req, res) => {
    try {
      await runDbExclusive(async () => {
        await db.exec("VACUUM");
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });

  // ---- Integrity check
  app.get("/api/db/integrity", async (req, res) => {
    try {
      const row = await db.get(`PRAGMA integrity_check`);
      res.json({ ok: true, result: row });
    } catch (e) {
      res.status(500).json({ ok: false, error: safeErrorMessage(e) });
    }
  });
}