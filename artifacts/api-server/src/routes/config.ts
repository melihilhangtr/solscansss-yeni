import { Router } from "express";
import { getConfig, saveConfig, type Config } from "../services/telemetry.js";

const ADMIN_PASSWORD = "123123123qweqweqwe";

const router = Router();

router.get("/config", (_req, res) => {
  res.json(getConfig());
});

router.post("/config", async (req, res) => {
  const password = req.headers["x-admin-password"] as string | undefined;
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized: invalid admin password" });
    return;
  }

  const body = req.body as Partial<Config>;
  const current = getConfig();
  const newConfig: Config = {
    mintAddress: (body.mintAddress ?? current.mintAddress).trim(),
    tokenName: (body.tokenName ?? current.tokenName).trim(),
    tokenImageUrl: (body.tokenImageUrl ?? current.tokenImageUrl).trim(),
    backgroundImageUrl: (
      body.backgroundImageUrl ?? current.backgroundImageUrl
    ).trim(),
    siteDesign: body.siteDesign ?? current.siteDesign,
  };
  await saveConfig(newConfig);
  res.json({ success: true, config: newConfig });
});

export default router;
