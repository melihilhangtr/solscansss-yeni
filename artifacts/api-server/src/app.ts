import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { loadConfig, startPolling } from "./services/telemetry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

loadConfig()
  .then(() => {
    startPolling();
    logger.info("Telemetry service started");
  })
  .catch((err: unknown) => {
    logger.error({ err }, "Failed to start telemetry");
  });

app.use("/api", router);

const publicDir = path.resolve(__dirname, "../public");
app.use("/api", express.static(publicDir));

// Root redirect → dashboard
app.get("/", (_req, res) => {
  res.redirect("/api/");
});

export default app;
