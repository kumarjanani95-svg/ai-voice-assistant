import { config } from "../config.js";
import type { LocationSuggestion } from "../types.js";

const AREA_TYPES = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "suburb",
  "neighbourhood",
  "neighborhood",
  "quarter",
  "city_district",
  "county",
  "state",
  "country",
  "region",
  "municipality",
  "district",
  "borough",
  "island",
  "administrative",
  "political",
  "residential",
  "commercial",
  "retail",
  "industrial",
]);

const AREA_CLASSES = new Set(["boundary", "place", "landuse"]);

const EXACT_CLASSES = new Set([
  "amenity",
  "shop",
  "tourism",
  "leisure",
  "building",
  "office",
  "healthcare",
  "historic",
  "craft",
]);

const EXACT_TYPES = new Set([
  "house",
  "building",
  "hotel",
  "mall",
  "supermarket",
  "bus_stop",
  "station",
  "tram_stop",
  "subway_entrance",
  "parking",
  "terminal",
]);

export type GeocodeHit = {
  formatted: string;
  lat: number;
  lng: number;
  type: string;
  kind: "exact" | "area";
  importance: number;
  bbox?: [number, number, number, number];
};

type NominatimItem = {
  display_name?: string;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  importance?: number;
  boundingbox?: string[];
};

let nextAllowedAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const wait = nextAllowedAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextAllowedAt = Date.now() + 1100;
}

export function isAreaHit(input: {
  type?: string;
  className?: string;
  addresstype?: string;
  bbox?: [number, number, number, number];
}): boolean {
  const type = (input.type ?? "").toLowerCase();
  const className = (input.className ?? "").toLowerCase();
  const addressType = (input.addresstype ?? "").toLowerCase();

  if (EXACT_TYPES.has(type) || EXACT_CLASSES.has(className) || addressType === "house") {
    if (type === "aerodrome" || type === "airport") return true;
    return false;
  }
  if (AREA_TYPES.has(type) || AREA_TYPES.has(addressType) || AREA_CLASSES.has(className)) {
    return true;
  }
  if (input.bbox) {
    const [south, north, west, east] = input.bbox;
    if (Math.abs(north - south) > 0.015 || Math.abs(east - west) > 0.015) return true;
  }
  return false;
}

function toHit(item: NominatimItem): GeocodeHit | null {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !item.display_name) return null;
  const bbox = item.boundingbox?.length === 4
    ? (item.boundingbox.map(Number) as [number, number, number, number])
    : undefined;
  const kind = isAreaHit({
    type: item.type,
    className: item.class,
    addresstype: item.addresstype,
    bbox,
  })
    ? "area"
    : "exact";
  return {
    formatted: item.display_name,
    lat,
    lng,
    type: `${item.class ?? "place"}:${item.type ?? item.addresstype ?? "unknown"}`,
    kind,
    importance: item.importance ?? 0,
    bbox,
  };
}

export async function searchPlaces(
  query: string,
  options: { viewbox?: string; bounded?: boolean; limit?: number } = {},
): Promise<GeocodeHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  await throttle();
  const url = new URL(`${config.geocoder.baseUrl}/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(options.limit ?? 8));
  url.searchParams.set("accept-language", "en");
  if (config.geocoder.countryCodes) {
    url.searchParams.set("countrycodes", config.geocoder.countryCodes);
  }
  if (options.viewbox) {
    url.searchParams.set("viewbox", options.viewbox);
    if (options.bounded) url.searchParams.set("bounded", "1");
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": config.geocoder.userAgent,
    },
  });
  if (!response.ok) {
    throw new Error(`Geocoder HTTP ${response.status}`);
  }
  const rows = (await response.json()) as NominatimItem[];
  return rows.map(toHit).filter((hit): hit is GeocodeHit => Boolean(hit));
}

export function hitsToSuggestions(hits: GeocodeHit[], limit = 5): LocationSuggestion[] {
  const seen = new Set<string>();
  const suggestions: LocationSuggestion[] = [];
  for (const hit of hits) {
    const key = `${hit.formatted}|${hit.lat.toFixed(5)}|${hit.lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      index: suggestions.length + 1,
      label: shortLabel(hit.formatted),
      formatted: hit.formatted,
      lat: hit.lat,
      lng: hit.lng,
      kind: hit.kind,
      type: hit.type,
    });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

export function shortLabel(formatted: string): string {
  return formatted.split(",").slice(0, 2).map((part) => part.trim()).join(", ");
}

export function viewboxFrom(hit: GeocodeHit): string | undefined {
  if (!hit.bbox) return undefined;
  const [south, north, west, east] = hit.bbox;
  return `${west},${north},${east},${south}`;
}

export function viewboxAround(lat: number, lng: number, delta = 0.12): string {
  return `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`;
}
