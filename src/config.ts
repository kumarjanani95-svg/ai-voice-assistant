import "dotenv/config";
import path from "node:path";

export const PROVIDERS = ["groq", "gemini", "ollama", "openai", "fallback"] as const;
export type Provider = (typeof PROVIDERS)[number];

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const groqApiKey = process.env.GROQ_API_KEY?.trim() ?? "";
const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
const openaiApiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");

function resolveProvider(): Provider {
  const requested = (process.env.LLM_PROVIDER ?? "groq").trim().toLowerCase();
  if (requested === "fallback") return "fallback";
  if (requested === "groq") return groqApiKey ? "groq" : "fallback";
  if (requested === "gemini") return geminiApiKey ? "gemini" : "fallback";
  if (requested === "ollama") return "ollama";
  if (requested === "openai") return openaiApiKey ? "openai" : "fallback";

  if (groqApiKey) return "groq";
  if (geminiApiKey) return "gemini";
  return "fallback";
}

export const config = {
  port: numberEnv("PORT", 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  provider: resolveProvider(),
  groqApiKey,
  geminiApiKey,
  openaiApiKey,
  ollamaBaseUrl,
  models: {
    groqChat: process.env.GROQ_CHAT_MODEL ?? "openai/gpt-oss-20b",
    groqStt: process.env.GROQ_STT_MODEL ?? "whisper-large-v3-turbo",
    geminiChat: process.env.GEMINI_CHAT_MODEL ?? "gemini-2.0-flash",
    ollamaChat: process.env.OLLAMA_CHAT_MODEL ?? "llama3.2",
    openaiChat: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
    openaiStt: process.env.OPENAI_STT_MODEL ?? "whisper-1",
    openaiTts: process.env.OPENAI_TTS_MODEL ?? "tts-1",
    openaiTtsVoice: process.env.OPENAI_TTS_VOICE ?? "alloy",
  },
  sessionTtlMs: numberEnv("SESSION_TTL_MS", 30 * 60 * 1000),
  memoryMessageLimit: numberEnv("MEMORY_MESSAGE_LIMIT", 24),
  sessionDir: process.env.SESSION_DIR?.trim() || path.join(process.cwd(), "data", "sessions"),
  maxAudioBytes: numberEnv("MAX_AUDIO_BYTES", 10 * 1024 * 1024),
  geocoder: {
    baseUrl: (process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org").replace(/\/$/, ""),
    countryCodes: process.env.GEOCODER_COUNTRY_CODES?.trim() ?? "",
    userAgent: process.env.GEOCODER_USER_AGENT ?? "OTOVOICE/1.0 (conversation-layer)",
  },
};

export const hasLlm = config.provider !== "fallback";
export const hasStt = config.provider === "groq" || config.provider === "openai";
export const hasTts = config.provider === "openai";
