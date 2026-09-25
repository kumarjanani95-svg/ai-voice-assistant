import { buildAction, placeResolved } from "../catalog/actions.js";
import type { ActionName, IntentName, PendingLocation, ProposedAction, Slots } from "../types.js";

function placeBody(place: NonNullable<Slots["pickup"]>) {
  return {
    query: place.raw ?? place.formatted,
    formatted: place.formatted,
    lat: place.lat,
    lng: place.lng,
  };
}

function tripBody(slots: Slots) {
  return {
    pickup: slots.pickup,
    destination: slots.destination,
    when: slots.when ?? "now",
    vehicleType: slots.vehicleType,
  };
}

export function deriveActions(input: {
  intentName: IntentName;
  slots: Slots;
  suggested: ActionName[];
  pending: ProposedAction[];
}): ProposedAction[] {
  const { intentName, slots, suggested, pending } = input;
  const actions: ProposedAction[] = [];
  const wants = new Set<ActionName>(suggested);

  if (intentName === "deny") return [];

  if (intentName === "confirm") {
    return pending.map((action) => ({ ...action, confirmed: true }));
  }

  if (slots.pickup && !placeResolved(slots.pickup)) {
    wants.add("geocode");
  }
  if (slots.destination && !placeResolved(slots.destination)) {
    wants.add("geocode");
  }

  if (intentName === "request_ride" && placeResolved(slots.pickup) && placeResolved(slots.destination)) {
    wants.add("create_booking");
  }
  if (intentName === "estimate_trip" && placeResolved(slots.pickup) && placeResolved(slots.destination)) {
    wants.add("fare_estimate");
    wants.add("directions");
  }
  if (intentName === "cancel_ride" && slots.bookingRef) wants.add("cancel_booking");
  if (intentName === "check_status" && slots.bookingRef) wants.add("booking_status");

  if (wants.has("geocode") && slots.pickup && !placeResolved(slots.pickup)) {
    actions.push(buildAction("geocode", { ...placeBody(slots.pickup), role: "pickup" }));
  }
  if (wants.has("geocode") && slots.destination && !placeResolved(slots.destination)) {
    actions.push(buildAction("geocode", { ...placeBody(slots.destination), role: "destination" }));
  }
  if (wants.has("reverse_geocode") && slots.pickup && placeResolved(slots.pickup) && !slots.pickup.formatted) {
    actions.push(
      buildAction("reverse_geocode", {
        lat: slots.pickup.lat,
        lng: slots.pickup.lng,
        role: "pickup",
      }),
    );
  }
  if (wants.has("directions") && placeResolved(slots.pickup) && placeResolved(slots.destination)) {
    actions.push(buildAction("directions", tripBody(slots)));
  }
  if (wants.has("fare_estimate") && placeResolved(slots.pickup) && placeResolved(slots.destination)) {
    actions.push(buildAction("fare_estimate", tripBody(slots)));
  }
  if (wants.has("create_booking") && placeResolved(slots.pickup) && placeResolved(slots.destination)) {
    actions.push(buildAction("create_booking", tripBody(slots)));
  }
  if (wants.has("cancel_booking") && slots.bookingRef) {
    actions.push(buildAction("cancel_booking", { bookingRef: slots.bookingRef }));
  }
  if (wants.has("booking_status") && slots.bookingRef) {
    actions.push(buildAction("booking_status", { bookingRef: slots.bookingRef }));
  }

  return actions;
}

export function applyActionResult(
  slots: Slots,
  action: ProposedAction,
  data: Record<string, unknown> = {},
): Slots {
  const next: Slots = {
    ...slots,
    pickup: slots.pickup ? { ...slots.pickup } : null,
    destination: slots.destination ? { ...slots.destination } : null,
  };

  const role = typeof action.body.role === "string" ? action.body.role : undefined;
  const formatted = typeof data.formatted === "string" ? data.formatted : null;
  const lat = typeof data.lat === "number" ? data.lat : null;
  const lng = typeof data.lng === "number" ? data.lng : null;
  const bookingRef = typeof data.bookingRef === "string" ? data.bookingRef : null;

  const applyPlace = (key: "pickup" | "destination") => {
    next[key] = {
      raw: next[key]?.raw ?? formatted,
      formatted: formatted ?? next[key]?.formatted ?? null,
      lat: lat ?? next[key]?.lat ?? null,
      lng: lng ?? next[key]?.lng ?? null,
    };
  };

  if ((action.name === "geocode" || action.name === "reverse_geocode") && (role === "pickup" || role === "destination")) {
    applyPlace(role);
  }
  if (bookingRef) next.bookingRef = bookingRef;

  return next;
}

export function uiHintFor(
  intentName: IntentName,
  actions: ProposedAction[],
  pendingLocation?: PendingLocation | null,
): {
  screen: "chat" | "confirm" | "trip_preview" | "status" | "location_pick";
  promptUser: boolean;
} {
  if (pendingLocation?.suggestions.length) {
    return { screen: "location_pick", promptUser: true };
  }
  if (actions.some((action) => action.requiresApproval && !action.confirmed)) {
    return { screen: "confirm", promptUser: true };
  }
  if (intentName === "estimate_trip" || intentName === "request_ride") {
    return { screen: "trip_preview", promptUser: false };
  }
  if (intentName === "check_status" || intentName === "cancel_ride") {
    return { screen: "status", promptUser: false };
  }
  return { screen: "chat", promptUser: false };
}
