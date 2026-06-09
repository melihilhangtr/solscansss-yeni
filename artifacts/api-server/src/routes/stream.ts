import { Router } from "express";
import {
  addClient,
  removeClient,
  getLatestData,
  getConfig,
} from "../services/telemetry.js";

const router = Router();

router.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  addClient(res);

  const config = getConfig();
  const data = getLatestData();
  res.write(`data: ${JSON.stringify({ type: "config", data: config })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: "update", data })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 20000);

  req.on("close", () => {
    removeClient(res);
    clearInterval(keepAlive);
  });
});

export default router;
