import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conversationRouter } from "./routes/conversation.js";
import { healthRouter } from "./routes/health.js";
import { speechRouter } from "./routes/speech.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(publicDir));
  app.use(healthRouter);
  app.use(speechRouter);
  app.use(conversationRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const err = error as { status?: number; message?: string };
    const status = err.status ?? 500;
    res.status(status).json({
      error: err.message ?? "Internal server error",
    });
  });

  return app;
}
