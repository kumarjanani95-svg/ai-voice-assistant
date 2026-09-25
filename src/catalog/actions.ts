import type { ActionName, ProposedAction } from "../types.js";

type CatalogEntry = Omit<ProposedAction, "id" | "body" | "confirmed">;

export const ACTION_CATALOG: Record<ActionName, CatalogEntry> = {
  geocode: {
    name: "geocode",
    target: "location_api",
    requiresApproval: false,
    method: "GET",
    path: "/geocode",
  },
  reverse_geocode: {
    name: "reverse_geocode",
    target: "location_api",
    requiresApproval: false,
    method: "GET",
    path: "/reverse-geocode",
  },
  directions: {
    name: "directions",
    target: "location_api",
    requiresApproval: false,
    method: "GET",
    path: "/directions",
  },
  fare_estimate: {
    name: "fare_estimate",
    target: "laravel",
    requiresApproval: false,
    method: "POST",
    path: "/fare-estimate",
  },
  create_booking: {
    name: "create_booking",
    target: "laravel",
    requiresApproval: true,
    method: "POST",
    path: "/bookings",
  },
  cancel_booking: {
    name: "cancel_booking",
    target: "laravel",
    requiresApproval: true,
    method: "POST",
    path: "/bookings/cancel",
  },
  booking_status: {
    name: "booking_status",
    target: "laravel",
    requiresApproval: false,
    method: "GET",
    path: "/bookings/status",
  },
};

export function buildAction(
  name: ActionName,
  body: Record<string, unknown>,
  confirmed = false,
): ProposedAction {
  const entry = ACTION_CATALOG[name];
  return {
    id: crypto.randomUUID(),
    ...entry,
    confirmed,
    body,
  };
}

export function placeResolved(place: { lat: number | null; lng: number | null } | null): boolean {
  return Boolean(place && place.lat != null && place.lng != null);
}
