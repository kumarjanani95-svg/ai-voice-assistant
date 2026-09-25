import OpenAI from "openai";
import { config, hasLlm } from "../config.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { llmTurnSchema, type LlmTurn } from "../schemas/turn.js";
import type { ConversationSession, DeviceContext } from "../types.js";

const JSON_INSTRUCTION = `Return ONLY valid JSON with this exact shape:
{
  "replyText": "short spoken reply",
  "intentName": "greet|help|set_pickup|set_destination|request_ride|estimate_trip|confirm|deny|cancel_ride|check_status|update_location|choose_location|chitchat|unknown",
  "confidence": 0.0,
  "slotUpdates": {
    "pickup": {"raw": null, "formatted": null, "lat": null, "lng": null},
    "destination": {"raw": null, "formatted": null, "lat": null, "lng": null},
    "when": null,
    "vehicleType": null,
    "bookingRef": null
  },
  "missingSlots": [],
  "suggestedActions": []
}
Use null for unknown values. Do not wrap the JSON in markdown.`;

function contextMessages(input: {
  session: ConversationSession;
  userText: string;
  context?: DeviceContext;
}) {
  const contextBlock = input.context
    ? `Device context: ${JSON.stringify(input.context)}`
    : "Device context: none";

  return {
    system: `${SYSTEM_PROMPT}\n\n${JSON_INSTRUCTION}`,
    state: `${contextBlock}\nConversation memory: ${input.session.summary}\nKnown slots: ${JSON.stringify(input.session.slots)}\nPending location: ${JSON.stringify(input.session.pendingLocation)}\nContinue this same conversation. Reuse known slots unless the rider changes them.`,
    history: input.session.messages.slice(-config.memoryMessageLimit),
    userText: input.userText,
  };
}

export function parseLlmTurn(raw: string): LlmTurn {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("LLM returned no JSON object");
  }
  return llmTurnSchema.parse(JSON.parse(stripped.slice(start, end + 1)));
}

async function extractWithOpenAiCompat(input: {
  apiKey: string;
  baseURL?: string;
  model: string;
  session: ConversationSession;
  userText: string;
  context?: DeviceContext;
}): Promise<LlmTurn> {
  const packed = contextMessages(input);
  const client = new OpenAI({ apiKey: input.apiKey, baseURL: input.baseURL });
  const completion = await client.chat.completions.create({
    model: input.model,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: packed.system },
      { role: "system", content: packed.state },
      ...packed.history,
      { role: "user", content: packed.userText },
    ],
  });
  const text = completion.choices[0]?.message.content;
  if (!text) throw new Error("LLM returned an empty completion");
  return parseLlmTurn(text);
}

async function extractWithGemini(input: {
  session: ConversationSession;
  userText: string;
  context?: DeviceContext;
}): Promise<LlmTurn> {
  const packed = contextMessages(input);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.models.geminiChat}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
  const contents = [
    ...packed.history.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    { role: "user", parts: [{ text: packed.userText }] },
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${packed.system}\n${packed.state}` }] },
      contents,
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gemini HTTP ${response.status}`);
  }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty completion");
  return parseLlmTurn(text);
}

async function extractWithOllama(input: {
  session: ConversationSession;
  userText: string;
  context?: DeviceContext;
}): Promise<LlmTurn> {
  const packed = contextMessages(input);
  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.models.ollamaChat,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: packed.system },
        { role: "system", content: packed.state },
        ...packed.history,
        { role: "user", content: packed.userText },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { message?: { content?: string } };
  const text = payload.message?.content ?? "";
  if (!text) throw new Error("Ollama returned an empty completion");
  return parseLlmTurn(text);
}

export async function extractTurn(input: {
  session: ConversationSession;
  userText: string;
  context?: DeviceContext;
}): Promise<LlmTurn> {
  if (!hasLlm) {
    throw new Error("No free LLM provider is configured");
  }

  if (config.provider === "groq") {
    return extractWithOpenAiCompat({
      apiKey: config.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1",
      model: config.models.groqChat,
      ...input,
    });
  }
  if (config.provider === "gemini") {
    return extractWithGemini(input);
  }
  if (config.provider === "ollama") {
    return extractWithOllama(input);
  }
  return extractWithOpenAiCompat({
    apiKey: config.openaiApiKey,
    model: config.models.openaiChat,
    ...input,
  });
}
