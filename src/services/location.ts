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
  const needle = text.trim().toLowerCase();
  if (needle.length < 3) return null;
  return (
    suggestions.find((item) => item.label.toLowerCase() === needle) ??
    suggestions.find((item) => item.formatted.toLowerCase().includes(needle) || item.label.toLowerCase().includes(needle)) ??
    null
  );
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

export function formatResolvedReply(role: "pickup" | "destination", place: Place, askNext: boolean): string {
  const name = place.formatted || place.raw || "that location";
  if (role === "pickup") {
    return askNext ? `Pickup set to ${name}. Where are you going?` : `Pickup set to ${name}.`;
  }
  return `Destination set to ${name}.`;
}

function shortAreaQuery(query: string): string {
  return query.replace(/\b(area|district|city|town)\b/gi, "").trim() || query;
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
  const place: Place = { raw: query, formatted: null, lat: null, lng: null };
  const nearby =
    context?.currentLat != null && context?.currentLng != null
      ? viewboxAround(context.currentLat, context.currentLng)
      : undefined;
  let hits: GeocodeHit[] = [];
  try {
    hits = await searchPlaces(query, { limit: 8, viewbox: nearby });
  } catch (error) {
    console.warn("Geocode failed:", error);
    return { status: "none", place, suggestions: [] };
  }
  if (!hits.length) return { status: "none", place, suggestions: [] };

  const bestExact = pickBestExact(hits);
  if (bestExact && hits[0]?.kind === "exact") {
    const suggestion = hitsToSuggestions([bestExact], 1)[0];
    if (suggestion) {
      return {
        status: "resolved",
        place: suggestionToPlace(query, suggestion),
        suggestions: [],
      };
    }
  }

  const top = hits[0];
  if (top?.kind === "area") {
    const viewbox = viewboxFrom(top);
    let inner: GeocodeHit[] = [];
    try {
      inner = viewbox ? await searchPlaces(query, { viewbox, bounded: true, limit: 10 }) : [];
      const exactCount = inner.filter((hit) => hit.kind === "exact").length;
      if (viewbox && exactCount < 3) {
        const extras = await searchPlaces(`${shortAreaQuery(query)} mall`, { viewbox, bounded: true, limit: 8 });
        inner = [...inner, ...extras];
      }
    } catch (error) {
      console.warn("Area geocode failed:", error);
    }
    const preferred = [...inner.filter((hit) => hit.kind === "exact"), ...hits.filter((hit) => hit.kind === "exact"), ...inner, ...hits];
    const suggestions = hitsToSuggestions(preferred, 5);
    if (suggestions.length === 1 && suggestions[0]?.kind === "exact") {
      return {
        status: "resolved",
        place: suggestionToPlace(query, suggestions[0]),
        suggestions: [],
      };
    }
    return { status: "clarify", place, suggestions };
  }

  const suggestions = hitsToSuggestions(hits, 5);
  if (suggestions.length === 1) {
    return {
      status: "resolved",
      place: suggestionToPlace(query, suggestions[0]!),
      suggestions: [],
    };
  }
  return { status: "clarify", place, suggestions };
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
