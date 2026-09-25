import type { LlmTurn } from "../schemas/turn.js";
import { parseSuggestionChoice } from "./location.js";
import { emptySlots } from "./sessions.js";
import type { DeviceContext, IntentName, PendingLocation, Place, Slots } from "../types.js";

export type FallbackMemory = {
  slots?: Slots;
  lastIntent?: IntentName | null;
  pendingLocation?: PendingLocation | null;
};

function place(raw: string, context?: DeviceContext, here = false): Place {
  const useHere = here && context?.currentLat != null && context?.currentLng != null;
  return {
    raw,
    formatted: null,
    lat: useHere ? context.currentLat! : null,
    lng: useHere ? context.currentLng! : null,
  };
}

function capture(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/[.?!,]+$/, "");
  }
  return null;
}

function label(slot: Place | null): string | null {
  return slot?.formatted || slot?.raw || null;
}

export function fallbackExtract(
  userText: string,
  context?: DeviceContext,
  memory: FallbackMemory = {},
): LlmTurn {
  const text = userText.trim();
  const lower = text.toLowerCase();
  const known = memory.slots ?? emptySlots();
  const slots: Slots = emptySlots();

  const here = /\b(here|my location|where i am|current location)\b/.test(lower);
  const pickupRaw = capture(lower, [
    /\b(?:from|pickup(?: at)?|pick me up(?: at| from)?|collect(?: me)?(?: at| from)?)\s+(.+?)(?:\s+(?:to|towards|going to|drop(?: at| me at)?|destination)\b|$)/i,
  ]);
  const destinationRaw = capture(text, [
    /\b(?:to|towards|going to|drop(?: me)?(?: at| off at)?|destination(?: is)?)\s+(.+)$/i,
  ]);

  if (pickupRaw) slots.pickup = place(pickupRaw, context, /\bhere\b/.test(pickupRaw));
  else if (here && /\b(pickup|pick me|from|collect)\b/.test(lower)) {
    slots.pickup = place("current location", context, true);
  }

  if (destinationRaw) slots.destination = place(destinationRaw);

  if (/\b(now|asap|right now|immediately)\b/.test(lower)) slots.when = "now";

  const bookingRef = capture(text, [
    /\b(?:booking|ride|trip|order)\s+(?:id|ref|reference|number|#)\s*[:#-]?\s*([A-Z0-9-]{4,})\b/i,
  ]);
  if (bookingRef) slots.bookingRef = bookingRef;

  const pickup = slots.pickup ?? known.pickup;
  const destination = slots.destination ?? known.destination;
  const knownRef = slots.bookingRef ?? known.bookingRef;

  const looksLikeBarePlace =
    !pickupRaw &&
    !destinationRaw &&
    text.split(/\s+/).length <= 8 &&
    !/\b(yes|yeah|yep|no|ok|okay|book|ride|taxi|cab|fare|price|status|cancel|help|hello|hi)\b/.test(lower);

  if (memory.pendingLocation && parseSuggestionChoice(text) != null) {
    return reply("choose_location", 0.95, slots, "Okay, I will use that exact location.");
  }

  if (memory.pendingLocation && looksLikeBarePlace) {
    if (memory.pendingLocation.role === "pickup") slots.pickup = place(text);
    else slots.destination = place(text);
  } else if (looksLikeBarePlace && known.pickup && !known.destination && !memory.pendingLocation) {
    slots.destination = place(text);
  } else if (looksLikeBarePlace && !known.pickup) {
    slots.pickup = place(text);
  }

  if (/\b(yes|yeah|yep|confirm|ok|okay|sure|book it|go ahead|please do)\b/.test(lower)) {
    return reply("confirm", 0.8, slots, "Okay. I will send that for you to approve.");
  }
  if (/\b(no|nope|don't|cancel that|never mind|stop)\b/.test(lower) && !/\bcancel (?:my |the )?(?:ride|booking|trip)\b/.test(lower)) {
    return reply("deny", 0.8, slots, "Understood. I will not send that request.");
  }
  if (/\bcancel (?:my |the )?(?:ride|booking|trip)\b/.test(lower)) {
    return reply(
      "cancel_ride",
      0.75,
      slots,
      knownRef ? "I can send a cancel request for that ride." : "What is the booking reference?",
      knownRef ? [] : ["bookingRef"],
    );
  }
  if (/\b(status|where is|track|eta)\b/.test(lower)) {
    return reply(
      "check_status",
      0.7,
      slots,
      knownRef ? "I can ask the app for that ride status." : "What is the booking reference?",
      knownRef ? [] : ["bookingRef"],
    );
  }
  if (/\b(fare|price|cost|how much|estimate)\b/.test(lower)) {
    const missing = [pickup ? null : "pickup", destination ? null : "destination"].filter(Boolean) as string[];
    return reply(
      "estimate_trip",
      0.75,
      slots,
      missing.length ? "I still need both places before I can ask the app for a fare." : "I can ask the app for a fare estimate.",
      missing,
    );
  }
  if (/\b(book|ride|taxi|cab|uber|trip)\b/.test(lower) || (slots.pickup && slots.destination)) {
    const missing = [pickup ? null : "pickup", destination ? null : "destination"].filter(Boolean) as string[];
    const spoken = missing.length
      ? missing.includes("pickup")
        ? "Where should I pick you up?"
        : "Where are you going?"
      : `I can prepare a booking from ${label(pickup)} to ${label(destination)}.`;
    return reply("request_ride", 0.8, slots, spoken, missing);
  }
  if (slots.pickup) {
    return reply(
      "set_pickup",
      0.7,
      slots,
      destination || known.destination ? "Pickup updated." : "Pickup noted. Where are you going?",
    );
  }
  if (slots.destination) {
    return reply(
      "set_destination",
      0.7,
      slots,
      pickup || known.pickup ? "Destination noted." : "Destination noted. Where should I pick you up?",
    );
  }
  if (/\b(hi|hello|hey|good morning|good evening)\b/.test(lower)) {
    const remembered = [label(known.pickup), label(known.destination)].filter(Boolean);
    const spoken = remembered.length
      ? `Hi. I still have ${remembered.join(" to ")}. Want to continue?`
      : "Hi. Where would you like to go?";
    return reply("greet", 0.9, slots, spoken);
  }
  if (/\b(help|what can you do)\b/.test(lower)) {
    return reply("help", 0.9, slots, "Tell me a pickup and destination. I will prepare a request for the app.");
  }

  if (known.pickup || known.destination) {
    return reply(
      "chitchat",
      0.4,
      slots,
      `I still have ${[label(known.pickup) && `pickup ${label(known.pickup)}`, label(known.destination) && `destination ${label(known.destination)}`].filter(Boolean).join(" and ")}. What should I do next?`,
    );
  }

  return reply("unknown", 0.3, slots, "I can help with a ride. Where should I pick you up, and where are you going?");
}

function reply(
  intentName: LlmTurn["intentName"],
  confidence: number,
  slotUpdates: Slots,
  replyText: string,
  missingSlots: string[] = [],
): LlmTurn {
  return {
    replyText,
    intentName,
    confidence,
    slotUpdates,
    missingSlots,
    suggestedActions: [],
  };
}
