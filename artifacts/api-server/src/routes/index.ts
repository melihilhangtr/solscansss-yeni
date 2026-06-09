import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import configRouter from "./config.js";
import streamRouter from "./stream.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(streamRouter);

export default router;
