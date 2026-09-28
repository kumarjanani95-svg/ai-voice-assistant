import { config, hasLlm, hasTts } from "../config.js";
import type {
  ActionResult,
  DeviceContext,
  LocationSuggestion,
  PendingLocation,
  Place,
  StructuredTurn,
} from "../types.js";
import type { LlmTurn } from "../schemas/turn.js";
import { applyActionResult, deriveActions, uiHintFor } from "./actions.js";
import { fallbackExtract } from "./fallback.js";
import { extractTurn } from "./llm.js";
import {
  applyLocationChoice,
  classifyPickupConfirmReply,
  formatPickupConfirmReply,
  formatResolvedReply,
  formatSuggestionReply,
  namedNewPickup,
  needsCoordinates,
  resolvePlace,
} from "./location.js";
import { hitsToSuggestions, type GeocodeHit } from "./geocode.js";
import {
  getOrCreateSession,
  getSession,
  mergePlace,
  mergeSlots,
  saveSession,
  setPendingActions,
} from "./sessions.js";
import { synthesizeSpeech, transcribeAudio } from "./speech.js";

function queryOf(place: Place | null): string {
  return (place?.raw || place?.formatted || "").trim();
}

function applyResolvedPlace(
  session: ReturnType<typeof getOrCreateSession>,
  role: "pickup" | "destination",
  place: Place,
): void {
  session.slots[role] = mergePlace(session.slots[role], place);
  if (session.pendingLocation?.role === role) session.pendingLocation = null;
  if (role === "pickup") session.pendingPickupConfirm = true;
}

function pickupLabel(place: Place | null): string {
  return place?.formatted || place?.raw || "that pickup";
}

function applyPickupConfirmation(
  session: ReturnType<typeof getOrCreateSession>,
  transcript: string,
  extracted: LlmTurn,
  previousPickup: Place | null,
): { reply: string | null; skipLocation: boolean } {
  if (!session.pendingPickupConfirm) return { reply: null, skipLocation: false };

  if (namedNewPickup(previousPickup, extracted.slotUpdates.pickup)) {
    session.slots.pickup = {
      raw: extracted.slotUpdates.pickup?.raw ?? extracted.slotUpdates.pickup?.formatted ?? transcript,
      formatted: extracted.slotUpdates.pickup?.formatted ?? null,
      lat: extracted.slotUpdates.pickup?.lat ?? null,
      lng: extracted.slotUpdates.pickup?.lng ?? null,
    };
    session.pendingPickupConfirm = false;
    session.pendingLocation = null;
    return { reply: null, skipLocation: false };
  }

  const decision = classifyPickupConfirmReply(transcript, extracted.intentName);
  if (decision === "proceed") {
    session.pendingPickupConfirm = false;
    extracted.intentName = "set_pickup";
    const next = session.slots.destination
      ? `Okay, proceeding with pickup at ${pickupLabel(session.slots.pickup)}.`
      : `Okay, proceeding with pickup at ${pickupLabel(session.slots.pickup)}. Where are you going?`;
    return { reply: next, skipLocation: !needsCoordinates(session.slots.destination) };
  }
  if (decision === "change") {
    session.slots.pickup = null;
    session.pendingPickupConfirm = false;
    session.pendingLocation = session.pendingLocation?.role === "pickup" ? null : session.pendingLocation;
    extracted.intentName = "update_location";
    extracted.slotUpdates.pickup = { raw: null, formatted: null, lat: null, lng: null };
    return { reply: "Okay, where should I pick you up instead?", skipLocation: true };
  }

  return { reply: formatPickupConfirmReply(session.slots.pickup!), skipLocation: true };
}

async function collectCoordinates(
  session: ReturnType<typeof getOrCreateSession>,
  transcript: string,
  context?: DeviceContext,
): Promise<{ reply: string | null; missingExact: string[] }> {
  let lastReply: string | null = null;
  if (session.pendingLocation) {
    const chosen = applyLocationChoice(session.pendingLocation, transcript);
    if (chosen) {
      const role = session.pendingLocation.role;
      applyResolvedPlace(session, role, chosen);
      lastReply =
        role === "pickup"
          ? formatPickupConfirmReply(session.slots[role]!)
          : formatResolvedReply(role, session.slots[role]!, false);
      if (role === "pickup") {
        return { reply: lastReply, missingExact: [] };
      }
    } else if (transcript.trim().length >= 3) {
      const role = session.pendingLocation.role;
      const resolution = await resolvePlace(transcript, role, context);
      if (resolution.status === "resolved") {
        applyResolvedPlace(session, role, resolution.place);
        if (role === "pickup") {
          return { reply: formatPickupConfirmReply(session.slots.pickup!), missingExact: [] };
        }
        lastReply = formatResolvedReply(role, session.slots[role]!, false);
        session.pendingLocation = null;
      } else if (resolution.status === "clarify" && resolution.suggestions.length) {
        session.pendingLocation = {
          role,
          query: transcript.trim(),
          suggestions: resolution.suggestions,
        };
        return {
          reply: formatSuggestionReply(role, transcript.trim(), resolution.suggestions),
          missingExact: [`${role}_exact`],
        };
      }
    }
  }

  const order: Array<"pickup" | "destination"> = session.pendingLocation
    ? [session.pendingLocation.role]
    : ["pickup", "destination"];

  for (const role of order) {
    const place = session.slots[role];
    if (!needsCoordinates(place)) continue;
    if (role === "destination" && needsCoordinates(session.slots.pickup)) break;

    const resolution = await resolvePlace(queryOf(place), role, context);
    if (resolution.status === "resolved") {
      applyResolvedPlace(session, role, resolution.place);
      if (role === "pickup") {
        return {
          reply: formatPickupConfirmReply(session.slots.pickup!),
          missingExact: [],
        };
      }
      lastReply = formatResolvedReply(role, session.slots[role]!, false);
      continue;
    }
    if (resolution.status === "clarify" && resolution.suggestions.length) {
      session.pendingLocation = {
        role,
        query: queryOf(place),
        suggestions: resolution.suggestions,
      };
      return {
        reply: formatSuggestionReply(role, queryOf(place), resolution.suggestions),
        missingExact: [`${role}_exact`],
      };
    }
    return {
      reply:
        role === "pickup"
          ? "I could not pin that pickup. Name a building, landmark, or street."
          : "I could not pin that destination. Name a building, landmark, or street.",
      missingExact: [`${role}_exact`],
    };
  }

  return { reply: lastReply, missingExact: [] };
}

export async function handleTurn(input: {
  sessionId?: string;
  text?: string;
  audio?: { buffer: Buffer; filename: string };
  speak?: boolean;
  context?: DeviceContext;
}): Promise<StructuredTurn> {
  const session = getOrCreateSession(input.sessionId);
  let transcript = input.text?.trim() ?? "";

  if (!transcript && input.audio) {
    transcript = await transcribeAudio(input.audio.buffer, input.audio.filename);
  }
  if (!transcript) {
    throw Object.assign(new Error("Provide text or audio"), { status: 400 });
  }

  let engine = config.provider;
  let extracted: LlmTurn;
  try {
    extracted = hasLlm
      ? await extractTurn({ session, userText: transcript, context: input.context })
      : fallbackExtract(transcript, input.context, {
          slots: session.slots,
          lastIntent: session.lastIntent,
          pendingLocation: session.pendingLocation,
          pendingPickupConfirm: session.pendingPickupConfirm,
        });
  } catch (error) {
    console.warn("LLM provider failed, using local fallback:", error);
    extracted = fallbackExtract(transcript, input.context, {
      slots: session.slots,
      lastIntent: session.lastIntent,
      pendingLocation: session.pendingLocation,
      pendingPickupConfirm: session.pendingPickupConfirm,
    });
    engine = "fallback";
  }

  session.messages.push({ role: "user", content: transcript });
  const previousPickup = session.slots.pickup;
  session.slots = mergeSlots(session.slots, extracted.slotUpdates);

  const confirmation = applyPickupConfirmation(session, transcript, extracted, previousPickup);
  session.lastIntent = extracted.intentName;
  let location = { reply: confirmation.reply, missingExact: [] as string[] };
  if (!confirmation.skipLocation) {
    location = await collectCoordinates(session, transcript, input.context);
    if (confirmation.reply && !location.reply) location.reply = confirmation.reply;
  }
  if (location.reply) extracted.replyText = location.reply;

  const proposedActions = deriveActions({
    intentName: extracted.intentName,
    slots: session.slots,
    suggested: extracted.suggestedActions,
    pending: session.pendingActions,
    pendingPickupConfirm: session.pendingPickupConfirm,
  });
  setPendingActions(session, proposedActions);
  session.awaitingResults = proposedActions;
  session.messages.push({ role: "assistant", content: extracted.replyText });
  saveSession(session);

  const missingSlots = [
    ...(extracted.missingSlots.length
      ? extracted.missingSlots
      : [
          !session.slots.pickup && ["request_ride", "estimate_trip"].includes(extracted.intentName)
            ? "pickup"
            : null,
          !session.slots.destination &&
          ["request_ride", "estimate_trip"].includes(extracted.intentName) &&
          !session.pendingPickupConfirm
            ? "destination"
            : null,
        ].filter(Boolean)),
    ...location.missingExact,
    ...(session.pendingPickupConfirm ? ["pickup_confirm"] : []),
  ] as string[];

  let audioBase64: string | null = null;
  let audioMime: string | null = null;
  if (input.speak && hasTts) {
    const spoken = await synthesizeSpeech(extracted.replyText);
    audioBase64 = spoken.audioBase64;
    audioMime = spoken.audioMime;
  }

  return {
    sessionId: session.id,
    transcript,
    reply: {
      text: extracted.replyText,
      audioBase64,
      audioMime,
    },
    intent: {
      name: extracted.intentName,
      confidence: extracted.confidence,
      slots: session.slots,
      missingSlots,
    },
    slots: session.slots,
    proposedActions,
    memory: {
      summary: session.summary,
      turnCount: session.messages.filter((message) => message.role === "user").length,
    },
    messages: session.messages,
    locationSuggestions: session.pendingLocation?.suggestions ?? [],
    pendingLocation: session.pendingLocation,
    pendingPickupConfirm: session.pendingPickupConfirm,
    uiHint: uiHintFor(extracted.intentName, proposedActions, session.pendingLocation, session.pendingPickupConfirm),
    engine,
  };
}

function suggestionsFromData(data: Record<string, unknown>): LocationSuggestion[] {
  if (!Array.isArray(data.candidates)) return [];
  const hits = data.candidates
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      const formatted = typeof row.formatted === "string" ? row.formatted : "";
      if (!formatted || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        formatted,
        lat,
        lng,
        type: typeof row.type === "string" ? row.type : "place:unknown",
        kind: row.kind === "area" ? "area" : "exact",
        importance: 0,
      } satisfies GeocodeHit;
    })
    .filter((item): item is GeocodeHit => Boolean(item));
  return hitsToSuggestions(hits, 5);
}

export function reportActionResult(sessionId: string, result: ActionResult): {
  sessionId: string;
  slots: StructuredTurn["slots"];
  applied: boolean;
  pendingLocation: PendingLocation | null;
  pendingPickupConfirm: boolean;
} {
  const session = getSession(sessionId);
  if (!session) {
    throw Object.assign(new Error("Session not found"), { status: 404 });
  }

  const action =
    session.awaitingResults.find((item) => item.id === result.actionId) ??
    session.pendingActions.find((item) => item.id === result.actionId);
  if (!action) {
    throw Object.assign(new Error("Action not found on this session"), { status: 404 });
  }

  if (result.ok) {
    const suggestions = suggestionsFromData(result.data ?? {});
    const role = action.body.role === "destination" ? "destination" : "pickup";
    if (suggestions.length > 1 || suggestions[0]?.kind === "area") {
      session.pendingLocation = {
        role,
        query: String(action.body.query ?? session.slots[role]?.raw ?? ""),
        suggestions,
      };
    } else {
      session.slots = applyActionResult(session.slots, action, result.data);
      if (session.pendingLocation?.role === role) session.pendingLocation = null;
      if (role === "pickup" && result.ok) session.pendingPickupConfirm = true;
    }
  }
  session.awaitingResults = session.awaitingResults.filter((item) => item.id !== result.actionId);
  session.pendingActions = session.pendingActions.filter((item) => item.id !== result.actionId);
  saveSession(session);

  return {
    sessionId: session.id,
    slots: session.slots,
    applied: result.ok,
    pendingLocation: session.pendingLocation,
    pendingPickupConfirm: session.pendingPickupConfirm,
  };
}
