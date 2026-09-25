import { Router } from "express";
import { config, hasLlm, hasStt, hasTts } from "../config.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "otovoice",
    engine: config.provider,
    capabilities: {
      llm: hasLlm,
      stt: hasStt,
      tts: hasTts,
    },
    boundaries: {
      mysql: false,
      bookingBusinessLogic: false,
      fareCalculation: false,
      directDbAccess: false,
    },
  });
});
