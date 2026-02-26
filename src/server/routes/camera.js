// src/server/routes/camera.js
import fs from "node:fs/promises";
import path from "node:path";
import { createMjpegCamera } from "../camera/mjpeg.js";

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readTrim(p) {
  try { return (await fs.readFile(p, "utf8")).trim(); } catch { return ""; }
}

async function listVideoNodes() {
  try {
    const entries = await fs.readdir("/dev");
    return entries
      .filter((n) => /^video\d+$/.test(n))
      .map((n) => `/dev/${n}`)
      // stable numeric sort
      .sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));
  } catch {
    return [];
  }
}

async function videoNodeName(devNode) {
  // /dev/video0 -> video0
  const base = path.basename(devNode);
  const sysNamePath = `/sys/class/video4linux/${base}/name`;
  return await readTrim(sysNamePath);
}

/**
 * Prefer stable /dev/v4l/by-id symlink for Logitech C270 (or any Logitech webcam).
 * This prevents "video number jumps" after USB resets / reconnect.
 */
async function findLogitechById() {
  const byIdDir = "/dev/v4l/by-id";
  if (!(await exists(byIdDir))) return "";

  try {
    const entries = await fs.readdir(byIdDir);

    // Prefer the primary capture interface: video-index0
    const preferred = entries.find((n) =>
      /logitech/i.test(n) && /video-index0/i.test(n)
    );
    if (preferred) return path.join(byIdDir, preferred);

    // Fallback: any logitech video node
    const any = entries.find((n) => /logitech/i.test(n) && /video/i.test(n));
    if (any) return path.join(byIdDir, any);

    return "";
  } catch {
    return "";
  }
}

/**
 * Filter out Raspberry Pi "virtual" V4L2 nodes that are NOT real USB camera capture devices.
 * These often appear as /dev/video10.. etc and can confuse simple fallback logic.
 */
function isRejectedVideoName(nameLower) {
  const rejectHints = [
    "bcm2835",   // Pi multimedia stack
    "isp",       // image signal processor nodes
    "rpivid",    // Pi video decoder
    "codec",     // codec virtual nodes
    "decode",
    "encode",
    "output",    // often non-capture
    "m2m",       // memory-to-memory
  ];
  return rejectHints.some((h) => nameLower.includes(h));
}

function isWantedCameraName(nameLower) {
  const wantHints = [
    "c270",
    "logitech",
    "webcam",
    "hd webcam",
    "uvc", // many USB cams expose UVC
  ];
  return wantHints.some((h) => nameLower.includes(h));
}

async function resolveCameraDev(preferred) {
  // 0) If CAM_DEV points to a stable by-id/by-path and it exists, use it
  if (preferred && (await exists(preferred))) return preferred;

  // 1) Try to auto-find a stable Logitech device in /dev/v4l/by-id
  const byId = await findLogitechById();
  if (byId && (await exists(byId))) return byId;

  // 2) Scan /dev/video* and match by sysfs name, while rejecting Pi virtual nodes
  const nodes = await listVideoNodes();

  // First pass: strong match (wanted + not rejected)
  for (const n of nodes) {
    if (!(await exists(n))) continue;
    const nm = (await videoNodeName(n)).toLowerCase();
    if (!nm) continue;
    if (isRejectedVideoName(nm)) continue;
    if (isWantedCameraName(nm)) return n;
  }

  // Second pass: any non-rejected node (better than picking bcm2835/isp)
  for (const n of nodes) {
    if (!(await exists(n))) continue;
    const nm = (await videoNodeName(n)).toLowerCase();
    if (!nm) continue;
    if (isRejectedVideoName(nm)) continue;
    return n;
  }

  // 3) Absolute last resort
  return "/dev/video0";
}

export async function mountCameraRoutes(app) {
  // Preferred device can be set via env:
  // export CAM_DEV="/dev/v4l/by-id/usb-Logitech_HD_Webcam_C270-video-index0"
  const preferred = process.env.CAM_DEV || "/dev/video0";
  const resolved = await resolveCameraDev(preferred);

  const camera = createMjpegCamera({
    dev: resolved,
    fps: Number(process.env.CAM_FPS || 10),
    size: process.env.CAM_SIZE || "640x480",
    inputFormat: process.env.CAM_FMT || "mjpeg",
    jpegQ: Number(process.env.CAM_Q || 8),

    // Helps after USB reconnect / undervoltage reset:
    warmupMs: Number(process.env.CAM_WARMUP || 1200),
  });

  console.log("[camera] preferred dev:", preferred);
  console.log("[camera] resolved dev:", resolved);

  app.get("/api/camera/mpjpeg", camera.handler);

  // Optional debug endpoints
  app.get("/api/camera/health", async (req, res) => {
    const nowResolved = await resolveCameraDev(preferred);
    res.json({
      ok: true,
      preferred,
      resolved: nowResolved,
      fps: Number(process.env.CAM_FPS || 10),
      size: process.env.CAM_SIZE || "640x480",
      inputFormat: process.env.CAM_FMT || "mjpeg",
      jpegQ: Number(process.env.CAM_Q || 8),
      warmupMs: Number(process.env.CAM_WARMUP || 1200),
    });
  });

  app.get("/api/camera/state", (req, res) => {
    res.json(camera.getState());
  });
}