// src/server/camera/mjpeg.js
// MJPEG over HTTP using ffmpeg (v4l2 -> mpjpeg -> pipe:1)
//
// Fixes included:
// - Proper client cleanup on req.close + res.close + res.error (prevents /dev/video0 busy after closing iframe)
// - Stops ffmpeg when last client disconnects
// - Auto fallback to /dev/v4l/by-id/*index0 or lowest /dev/videoN if current device disappears
// - Backoff restart if ffmpeg exits while clients still connected

import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

export function createMjpegCamera(opts = {}) {
  const cfg = {
    dev: opts.dev || "/dev/video0",     // can also be /dev/v4l/by-id/...
    fps: Number(opts.fps || 10),
    size: String(opts.size || "640x480"),
    inputFormat: String(opts.inputFormat || "mjpeg"),
    jpegQ: Number(opts.jpegQ || 8),

    // Internal safety / behavior
    restartMinMs: Number(opts.restartMinMs || 1500),
    restartMaxMs: Number(opts.restartMaxMs || 8000),
    stderrTailLines: Number(opts.stderrTailLines || 30),
    warmupMs: Number(opts.warmupMs || 0),
  };

  console.log("[camera] ffmpeg config:", {
    dev: cfg.dev,
    fps: cfg.fps,
    size: cfg.size,
    inputFormat: cfg.inputFormat,
    jpegQ: cfg.jpegQ,
  });

  const state = {
    clients: new Set(),     // active HTTP responses
    proc: null,             // ffmpeg child process
    starting: false,
    stopping: false,
    restartTimer: null,
    restartDelayMs: cfg.restartMinMs,
    lastStartAt: 0,
    stderrBuf: [],
  };

  async function exists(p) {
    try { await fs.access(p); return true; } catch { return false; }
  }

  async function resolveVideoFallback() {
    // Prefer stable by-id paths if available
    try {
      const byIdDir = "/dev/v4l/by-id";
      if (await exists(byIdDir)) {
        const entries = await fs.readdir(byIdDir);
        const candidates = entries
          .filter((n) => n.includes("video") && n.includes("index0"))
          .map((n) => `${byIdDir}/${n}`);
        for (const p of candidates) {
          if (await exists(p)) return p;
        }
      }
    } catch {
      // ignore
    }

    // Otherwise pick the lowest /dev/videoN
    try {
      const entries = await fs.readdir("/dev");
      const vids = entries
        .filter((n) => /^video\d+$/.test(n))
        .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
      for (const n of vids) {
        const p = `/dev/${n}`;
        if (await exists(p)) return p;
      }
      return null;
    } catch {
      return null;
    }
  }

  function buildFfmpegArgs() {
    return [
      "-hide_banner",
      "-loglevel", "warning",
      "-f", "v4l2",
      "-input_format", cfg.inputFormat,
      "-framerate", String(cfg.fps),
      "-video_size", cfg.size,
      "-i", cfg.dev,
      "-f", "mpjpeg",
      "-q:v", String(cfg.jpegQ),
      "pipe:1",
    ];
  }

  function tailPush(line) {
    state.stderrBuf.push(line);
    if (state.stderrBuf.length > cfg.stderrTailLines) {
      state.stderrBuf.splice(0, state.stderrBuf.length - cfg.stderrTailLines);
    }
  }

  function clearRestartTimer() {
    if (state.restartTimer) clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }

  function scheduleRestart(reason = "") {
    if (state.clients.size === 0) return;
    if (state.restartTimer) return;

    const ms = Math.min(cfg.restartMaxMs, Math.max(cfg.restartMinMs, state.restartDelayMs));
    console.warn(`[camera] scheduling restart in ${ms}ms (${reason})`);

    state.restartTimer = setTimeout(async () => {
      state.restartTimer = null;
      await start(`restart:${reason}`).catch(() => {});
    }, ms);

    state.restartDelayMs = Math.min(cfg.restartMaxMs, Math.floor(ms * 1.25 + 250));
  }

  async function broadcastChunk(buf) {
    for (const res of Array.from(state.clients)) {
      try {
        res.write(buf);
      } catch {
        try { res.end(); } catch {}
        state.clients.delete(res);
      }
    }

    if (state.clients.size === 0) {
      await stop("no-clients");
    }
  }

  async function stop(reason = "") {
    if (state.stopping) return;
    state.stopping = true;

    clearRestartTimer();

    const p = state.proc;
    state.proc = null;

    try {
      if (p) {
        console.log(`[camera] stopping ffmpeg mpjpeg (${reason})`);
        p.kill("SIGTERM");
        const killT = setTimeout(() => {
          try { p.kill("SIGKILL"); } catch {}
        }, 1200);
        await new Promise((res) => p.once("exit", () => res()));
        clearTimeout(killT);
      }
    } catch {
      // ignore
    } finally {
      state.stopping = false;
      state.restartDelayMs = cfg.restartMinMs;
    }
  }

  async function start(reason = "") {
    if (state.proc) return;
    if (state.starting) return;
    if (state.clients.size === 0) return;

    state.starting = true;
    clearRestartTimer();

    try {
      if (cfg.warmupMs > 0) await delay(cfg.warmupMs);

      if (!(await exists(cfg.dev))) {
        console.warn("[camera] device missing:", cfg.dev);

        const fallback = await resolveVideoFallback();
        if (fallback) {
          console.log("[camera] switching to fallback device:", fallback);
          cfg.dev = fallback;
        } else {
          console.warn("[camera] no video devices found");
          scheduleRestart("no-device");
          return;
        }
      }

      state.lastStartAt = now();
      state.stderrBuf = [];

      const args = buildFfmpegArgs();
      console.log("[camera] starting ffmpeg mpjpeg:", "ffmpeg", args.join(" "));

      const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      state.proc = p;
      state.restartDelayMs = cfg.restartMinMs;

      p.stdout.on("data", async (chunk) => {
        if (state.clients.size === 0) return;
        await broadcastChunk(chunk);
      });

      let stderrPartial = "";
      p.stderr.on("data", (chunk) => {
        const s = String(chunk);
        stderrPartial += s;
        let idx;
        while ((idx = stderrPartial.indexOf("\n")) >= 0) {
          const line = stderrPartial.slice(0, idx).trimEnd();
          stderrPartial = stderrPartial.slice(idx + 1);
          if (line) {
            tailPush(line);
            console.warn("[camera] ffmpeg mpjpeg:", line);
          }
        }
      });

      p.on("exit", async (code, sig) => {
        const wasOurProc = state.proc === p;
        if (wasOurProc) state.proc = null;

        console.warn("[camera] ffmpeg exited", { code, sig });

        const tail = state.stderrBuf.join("\n");
        if (tail) console.warn("[camera] ffmpeg stderr (tail):\n" + tail);

        if (state.clients.size > 0) scheduleRestart("ffmpeg-exit");
      });

      p.on("error", (e) => {
        console.warn("[camera] ffmpeg spawn error:", e?.message || e);
        if (state.clients.size > 0) scheduleRestart("spawn-error");
      });
    } finally {
      state.starting = false;
    }
  }

  // ✅ FIX: cleanup must attach to BOTH req and res for iframe/SPA close
  function addClient(req, res) {
    state.clients.add(res);

    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;

      if (state.clients.has(res)) state.clients.delete(res);
      try { res.end(); } catch {}

      if (state.clients.size === 0) {
        await stop("no-clients");
      }
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);

    start("client-connect").catch(() => {});
  }

  async function handler(req, res) {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=ffmpeg",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Connection: "keep-alive",
    });

    addClient(req, res);
  }

  async function shutdown() {
    for (const res of Array.from(state.clients)) {
      try { res.end(); } catch {}
      state.clients.delete(res);
    }
    await stop("shutdown");
  }

  return {
    handler,
    shutdown,
    getState() {
      return {
        clients: state.clients.size,
        running: !!state.proc,
        dev: cfg.dev,
        fps: cfg.fps,
        size: cfg.size,
        inputFormat: cfg.inputFormat,
        jpegQ: cfg.jpegQ,
        lastStartAt: state.lastStartAt || null,
        restartDelayMs: state.restartDelayMs,
      };
    },
  };
}