import OpenAI, { toFile } from "openai";
import { config, hasStt, hasTts } from "../config.js";

function speechClient(): OpenAI {
  if (config.provider === "groq") {
    return new OpenAI({
      apiKey: config.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  if (config.provider === "openai") {
    return new OpenAI({ apiKey: config.openaiApiKey });
  }
  throw new Error("Server speech is only available for Groq or OpenAI");
}

export async function transcribeAudio(
  buffer: Buffer,
  filename = "speech.webm",
): Promise<string> {
  if (!hasStt) {
    throw Object.assign(
      new Error("Server STT is unavailable. Send text, or use browser speech recognition."),
      { status: 501 },
    );
  }
  const file = await toFile(buffer, filename);
  const result = await speechClient().audio.transcriptions.create({
    file,
    model: config.provider === "groq" ? config.models.groqStt : config.models.openaiStt,
  });
  return result.text.trim();
}

export async function synthesizeSpeech(text: string): Promise<{
  audioBase64: string;
  audioMime: string;
}> {
  if (!hasTts) {
    throw Object.assign(
      new Error("Server TTS is unavailable. Use the browser SpeechSynthesis API."),
      { status: 501 },
    );
  }
  const response = await speechClient().audio.speech.create({
    model: config.models.openaiTts,
    voice: config.models.openaiTtsVoice,
    input: text,
    response_format: "mp3",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    audioBase64: bytes.toString("base64"),
    audioMime: "audio/mpeg",
  };
}
