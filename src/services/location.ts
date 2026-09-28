import { placeResolved } from "../catalog/actions.js";
import type { LocationSuggestion, PendingLocation, Place } from "../types.js";
import type { DeviceContext } from "../types.js";
import { hitsToSuggestions, searchPlaces, viewboxAround, viewboxFrom, type GeocodeHit } from "./geocode.js";

export type LocationResolution =
  | { status: "resolved"; place: Place; suggestions: LocationSuggestion[] }
  | { status: "clarify"; place: Place; suggestions: LocationSuggestion[] }
  | { status: "none"; place: Place; suggestions: LocationSuggestion[] };

const ORDINALS: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
};

export function parseSuggestionChoice(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  const direct = trimmed.match(/^(?:option|number|choice|#)?\s*([1-5])(?:\b|[.)])$/i);
  if (direct) return Number(direct[1]);
  const spoken = trimmed.match(/\b(?:option|number|choice|#)\s*([1-5])\b/);
  if (spoken) return Number(spoken[1]);
  for (const [word, value] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(trimmed)) return value;
  }
  return null;
}

export function matchSuggestionByName(
  text: string,
  suggestions: LocationSuggestion[],
): LocationSuggestion | null {
  const needle = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (needle.length < 3) return null;
  const scored = suggestions
    .map((item) => {
      const label = item.label.toLowerCase();
      const formatted = item.formatted.toLowerCase();
      if (label === needle || formatted === needle) return { item, score: 3 };
      if (label.includes(needle) || formatted.includes(needle) || needle.includes(label)) {
        return { item, score: 2 };
      }
      const tokens = needle.split(" ").filter((part) => part.length > 2);
      const hay = `${label} ${formatted}`;
      const hits = tokens.filter((part) => hay.includes(part)).length;
      if (tokens.length && hits === tokens.length) return { item, score: 1 };
      return { item, score: 0 };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.item ?? null;
}

export function sanitizePlaceQuery(query: string): string {
  let q = query.trim().replace(/^["']+|["']+$/g, "");
  q = q.replace(/^(please\s+)?((pick me up|pickup|pick up|collect me)\s+)?(at|from|near)\s+/i, "");
  q = q.replace(/^(i want to go from|from)\s+/i, "");
  q = q.replace(/\s+(please|now)$/i, "");
  q = q.replace(/\s+/g, " ").trim();
  if (!q || /^null$/i.test(q)) return "";
  if (q.length > 90) q = q.split(/[,.]/)[0]?.trim() || q.slice(0, 90);
  return q;
}

export function suggestionToPlace(query: string, suggestion: LocationSuggestion): Place {
  return {
    raw: query,
    formatted: suggestion.formatted,
    lat: suggestion.lat,
    lng: suggestion.lng,
  };
}

export function formatSuggestionReply(role: "pickup" | "destination", query: string, suggestions: LocationSuggestion[]): string {
  const heading =
    role === "pickup"
      ? `${query} is a large area. Which exact pickup?`
      : `${query} is a large area. Which exact drop-off?`;
  const lines = suggestions.map((item) => `${item.index}. ${item.label}`);
  return [heading, ...lines].join(" ");
}

export function formatPickupConfirmReply(place: Place): string {
  const name = place.formatted || place.raw || "this location";
  return `Pickup is ${name}. Should I proceed with this pickup, or do you want to change it?`;
}

export function formatResolvedReply(role: "pickup" | "destination", place: Place, askNext: boolean): string {
  const name = place.formatted || place.raw || "that location";
  if (role === "pickup") {
    return formatPickupConfirmReply(place);
  }
  return askNext ? `Destination set to ${name}.` : `Destination set to ${name}.`;
}

export function classifyPickupConfirmReply(text: string, intentName?: string): "proceed" | "change" | "other" {
  const lower = text.trim().toLowerCase();
  if (intentName === "confirm") return "proceed";
  if (intentName === "deny" || intentName === "update_location") return "change";
  if (
    /\b(proceed|go ahead|keep (it|this|that)|use (this|that)|that's (fine|right|ok|okay|correct)|that is (fine|right|ok|okay|correct)|confirm)\b/.test(
      lower,
    )
  ) {
    return "proceed";
  }
  if (/^(yes|yeah|yep|ok|okay|sure|y)$/i.test(lower)) return "proceed";
  if (/\b(change|different|another pickup|new pickup|somewhere else|not (this|that)|wrong)\b/.test(lower)) {
    return "change";
  }
  if (/^(no|nope|nah)$/i.test(lower)) return "change";
  return "other";
}

function pickupName(place: Place | null): string {
  return (place?.formatted || place?.raw || "").trim().toLowerCase();
}

export function namedNewPickup(current: Place | null, incoming: Place | null): boolean {
  const next = pickupName(incoming);
  if (!next) return false;
  const prev = pickupName(current);
  return next !== prev;
}

function shortAreaQuery(query: string): string {
  return query.replace(/\b(area|district|city|town)\b/gi, "").trim() || query;
}

function pickBestHit(hits: GeocodeHit[]): GeocodeHit | null {
  if (!hits.length) return null;
  const exact = hits.filter((hit) => hit.kind === "exact");
  const ranked = (exact.length ? exact : hits).slice().sort((a, b) => b.importance - a.importance);
  return ranked[0] ?? hits[0] ?? null;
}

function pickBestExact(hits: GeocodeHit[]): GeocodeHit | null {
  const exact = hits.filter((hit) => hit.kind === "exact");
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1 && (exact[0]?.importance ?? 0) >= (exact[1]?.importance ?? 0) + 0.15) {
    return exact[0] ?? null;
  }
  return null;
}

export async function resolvePlace(
  query: string,
  role: "pickup" | "destination",
  context?: DeviceContext,
): Promise<LocationResolution> {
  const cleaned = sanitizePlaceQuery(query);
  const place: Place = { raw: cleaned || query, formatted: null, lat: null, lng: null };
  if (!cleaned) return { status: "none", place, suggestions: [] };

  const nearby =
    context?.currentLat != null &&
    context?.currentLng != null &&
    Math.abs(context.currentLat) > 0.01 &&
    Math.abs(context.currentLng) > 0.01
      ? viewboxAround(context.currentLat, context.currentLng)
      : undefined;
  let hits: GeocodeHit[] = [];
  try {
    hits = await searchPlaces(cleaned, { limit: 8, viewbox: nearby });
  } catch (error) {
    console.warn("Geocode failed:", error);
    return { status: "none", place, suggestions: [] };
  }
  if (!hits.length) return { status: "none", place, suggestions: [] };

  const resolvedFrom = (hit: GeocodeHit): LocationResolution => {
    const suggestion = hitsToSuggestions([hit], 1)[0];
    if (!suggestion) return { status: "none", place, suggestions: [] };
    return {
      status: "resolved",
      place: suggestionToPlace(cleaned, suggestion),
      suggestions: [],
    };
  };

  if (role === "pickup") {
    const best = pickBestHit(hits);
    return best ? resolvedFrom(best) : { status: "none", place, suggestions: [] };
  }

  const bestExact = pickBestExact(hits);
  if (bestExact && hits[0]?.kind === "exact") {
    return resolvedFrom(bestExact);
  }

  const top = hits[0];
  if (top?.kind === "area") {
    const viewbox = viewboxFrom(top);
    let inner: GeocodeHit[] = [];
    try {
      inner = viewbox ? await searchPlaces(cleaned, { viewbox, bounded: true, limit: 10 }) : [];
      const exactCount = inner.filter((hit) => hit.kind === "exact").length;
      if (viewbox && exactCount < 3) {
        const extras = await searchPlaces(`${shortAreaQuery(cleaned)} mall`, { viewbox, bounded: true, limit: 8 });
        inner = [...inner, ...extras];
      }
    } catch (error) {
      console.warn("Area geocode failed:", error);
    }
    const preferred = [...inner.filter((hit) => hit.kind === "exact"), ...hits.filter((hit) => hit.kind === "exact"), ...inner, ...hits];
    const suggestions = hitsToSuggestions(preferred, 5);
    if (suggestions.length === 1 && suggestions[0]?.kind === "exact") {
      return resolvedFrom({
        formatted: suggestions[0].formatted,
        lat: suggestions[0].lat,
        lng: suggestions[0].lng,
        type: suggestions[0].type,
        kind: suggestions[0].kind,
        importance: 0,
      });
    }
    if (suggestions.length) return { status: "clarify", place, suggestions };
    const fallback = pickBestHit(hits);
    return fallback ? resolvedFrom(fallback) : { status: "none", place, suggestions: [] };
  }

  const suggestions = hitsToSuggestions(hits, 5);
  if (suggestions.length === 1) {
    return resolvedFrom({
      formatted: suggestions[0]!.formatted,
      lat: suggestions[0]!.lat,
      lng: suggestions[0]!.lng,
      type: suggestions[0]!.type,
      kind: suggestions[0]!.kind,
      importance: 0,
    });
  }
  if (suggestions.length) return { status: "clarify", place, suggestions };
  const fallback = pickBestHit(hits);
  return fallback ? resolvedFrom(fallback) : { status: "none", place, suggestions: [] };
}

export function applyLocationChoice(
  pending: PendingLocation,
  text: string,
): Place | null {
  const index = parseSuggestionChoice(text);
  if (index != null) {
    const picked = pending.suggestions.find((item) => item.index === index);
    return picked ? suggestionToPlace(pending.query, picked) : null;
  }
  const named = matchSuggestionByName(text, pending.suggestions);
  return named ? suggestionToPlace(pending.query, named) : null;
}

export function needsCoordinates(place: Place | null): boolean {
  return Boolean(place?.raw || place?.formatted) && !placeResolved(place);
}
