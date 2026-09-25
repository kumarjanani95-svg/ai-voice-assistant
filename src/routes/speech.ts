import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { synthesizeSpeech, transcribeAudio } from "../services/speech.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAudioBytes },
});

export const speechRouter = Router();

speechRouter.post("/v1/speech/transcribe", upload.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "audio file is required" });
      return;
    }
    const text = await transcribeAudio(req.file.buffer, req.file.originalname);
    res.json({ text });
  } catch (error) {
    next(error);
  }
});

speechRouter.post("/v1/speech/speak", async (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const spoken = await synthesizeSpeech(text);
    res.json(spoken);
  } catch (error) {
    next(error);
  }
});
