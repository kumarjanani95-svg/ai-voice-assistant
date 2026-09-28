import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { actionResultSchema, turnRequestSchema } from "../schemas/turn.js";
import { handleTurn, reportActionResult } from "../services/conversation.js";
import { deleteSession, getSession } from "../services/sessions.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAudioBytes },
});

export const conversationRouter = Router();

function parseBody(raw: unknown) {
  if (raw && typeof raw === "object") return raw;
  return {};
}

conversationRouter.post("/v1/conversation/turn", upload.single("audio"), async (req, res, next) => {
  try {
    let context = req.body?.context;
    if (typeof context === "string" && context.trim()) {
      try {
        context = JSON.parse(context);
      } catch {
        res.status(400).json({ error: "context must be valid JSON" });
        return;
      }
    } else if (!context) {
      context = undefined;
    }

    const parsed = turnRequestSchema.safeParse({
      ...parseBody(req.body),
      speak: req.body?.speak === "true" || req.body?.speak === true || req.query.speak === "1",
      context,
    });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const result = await handleTurn({
      sessionId: parsed.data.sessionId,
      text: parsed.data.text,
      audio: req.file
        ? { buffer: req.file.buffer, filename: req.file.originalname || "speech.webm" }
        : undefined,
      speak: parsed.data.speak,
      context: parsed.data.context,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

conversationRouter.get("/v1/conversation/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({
    sessionId: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    slots: session.slots,
    lastIntent: session.lastIntent,
    summary: session.summary,
    pendingLocation: session.pendingLocation,
    locationSuggestions: session.pendingLocation?.suggestions ?? [],
    pendingPickupConfirm: session.pendingPickupConfirm,
    pendingActions: session.pendingActions,
    messages: session.messages,
  });
});

conversationRouter.post("/v1/conversation/:sessionId/action-result", (req, res, next) => {
  try {
    const parsed = actionResultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.json(reportActionResult(req.params.sessionId, parsed.data));
  } catch (error) {
    next(error);
  }
});

conversationRouter.delete("/v1/conversation/:sessionId", (req, res) => {
  const removed = deleteSession(req.params.sessionId);
  res.status(removed ? 204 : 404).end();
});
