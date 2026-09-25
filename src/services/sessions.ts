import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import type { ConversationSession, Place, ProposedAction, Slots } from "../types.js";

const store = new Map<string, ConversationSession>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function emptyPlace(): Place {
  return { raw: null, formatted: null, lat: null, lng: null };
}

export function emptySlots(): Slots {
  return {
    pickup: null,
    destination: null,
    when: null,
    vehicleType: null,
    bookingRef: null,
  };
}

export function buildSummary(session: Pick<ConversationSession, "slots" | "lastIntent" | "messages" | "pendingLocation">): string {
  const placeLabel = (place: Place | null) => {
    if (!place) return null;
    const name = place.formatted || place.raw;
    if (!name) return null;
    return place.lat != null && place.lng != null ? `${name} (${place.lat}, ${place.lng})` : name;
  };
  const facts = [
    placeLabel(session.slots.pickup) ? `Pickup is ${placeLabel(session.slots.pickup)}` : null,
    placeLabel(session.slots.destination) ? `Destination is ${placeLabel(session.slots.destination)}` : null,
    session.pendingLocation
      ? `Waiting for exact ${session.pendingLocation.role} in ${session.pendingLocation.query}`
      : null,
    session.slots.when ? `When: ${session.slots.when}` : null,
    session.slots.vehicleType ? `Vehicle: ${session.slots.vehicleType}` : null,
    session.slots.bookingRef ? `Booking ref ${session.slots.bookingRef}` : null,
    session.lastIntent ? `Last intent: ${session.lastIntent}` : null,
  ].filter(Boolean);

  const lastUser = [...session.messages].reverse().find((message) => message.role === "user");
  if (lastUser) facts.push(`Last rider message: ${lastUser.content}`);

  return facts.join(". ") || "New conversation. No trip details yet.";
}

function ensureDir(dir = config.sessionDir): void {
  fs.mkdirSync(dir, { recursive: true });
}

function sessionFile(id: string, dir = config.sessionDir): string {
  if (!UUID_RE.test(id)) {
    throw Object.assign(new Error("Invalid session id"), { status: 400 });
  }
  return path.join(dir, `${id}.json`);
}

export function persistSession(session: ConversationSession, dir = config.sessionDir): void {
  ensureDir(dir);
  const file = sessionFile(session.id, dir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function loadSessionFromDisk(id: string, dir = config.sessionDir): ConversationSession | undefined {
  if (!UUID_RE.test(id)) return undefined;
  const file = sessionFile(id, dir);
  if (!fs.existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ConversationSession;
    return {
      ...raw,
      messages: raw.messages ?? [],
      slots: raw.slots ?? emptySlots(),
      pendingActions: raw.pendingActions ?? [],
      awaitingResults: raw.awaitingResults ?? [],
      pendingLocation: raw.pendingLocation ?? null,
      summary: raw.summary ?? buildSummary(raw),
      lastIntent: raw.lastIntent ?? null,
    };
  } catch {
    return undefined;
  }
}

function removeSessionFile(id: string, dir = config.sessionDir): void {
  if (!UUID_RE.test(id)) return;
  const file = sessionFile(id, dir);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function createSession(id?: string): ConversationSession {
  const now = new Date().toISOString();
  const session: ConversationSession = {
    id: id && UUID_RE.test(id) ? id : uuid(),
    createdAt: now,
    updatedAt: now,
    messages: [],
    slots: emptySlots(),
    lastIntent: null,
    pendingActions: [],
    awaitingResults: [],
    pendingLocation: null,
    summary: "New conversation. No trip details yet.",
  };
  store.set(session.id, session);
  persistSession(session);
  return session;
}

export function getSession(id: string): ConversationSession | undefined {
  const cached = store.get(id);
  if (cached) return cached;
  const loaded = loadSessionFromDisk(id);
  if (loaded) store.set(id, loaded);
  return loaded;
}

export function getOrCreateSession(id?: string): ConversationSession {
  if (id) {
    const existing = getSession(id);
    if (existing) return existing;
    if (UUID_RE.test(id)) return createSession(id);
  }
  return createSession();
}

export function saveSession(session: ConversationSession): ConversationSession {
  session.summary = buildSummary(session);
  session.updatedAt = new Date().toISOString();
  store.set(session.id, session);
  persistSession(session);
  return session;
}

export function deleteSession(id: string): boolean {
  const existed = store.delete(id) || Boolean(loadSessionFromDisk(id));
  removeSessionFile(id);
  store.delete(id);
  return existed;
}

export function mergePlace(current: Place | null, incoming: Place | null): Place | null {
  if (!incoming) return current;
  const base = current ?? emptyPlace();
  return {
    raw: incoming.raw ?? base.raw,
    formatted: incoming.formatted ?? base.formatted,
    lat: incoming.lat ?? base.lat,
    lng: incoming.lng ?? base.lng,
  };
}

export function mergeSlots(current: Slots, incoming: Slots): Slots {
  return {
    pickup: mergePlace(current.pickup, incoming.pickup),
    destination: mergePlace(current.destination, incoming.destination),
    when: incoming.when ?? current.when,
    vehicleType: incoming.vehicleType ?? current.vehicleType,
    bookingRef: incoming.bookingRef ?? current.bookingRef,
  };
}

export function setPendingActions(session: ConversationSession, actions: ProposedAction[]): void {
  session.pendingActions = actions.filter((action) => action.requiresApproval);
}

export function pruneExpiredSessions(now = Date.now()): number {
  let removed = 0;
  const seen = new Set<string>();

  for (const [id, session] of store) {
    seen.add(id);
    if (now - Date.parse(session.updatedAt) > config.sessionTtlMs) {
      deleteSession(id);
      removed += 1;
    }
  }

  if (fs.existsSync(config.sessionDir)) {
    for (const name of fs.readdirSync(config.sessionDir)) {
      const id = name.replace(/\.json$/, "");
      if (seen.has(id) || !UUID_RE.test(id)) continue;
      const session = loadSessionFromDisk(id);
      if (!session || now - Date.parse(session.updatedAt) > config.sessionTtlMs) {
        removeSessionFile(id);
        removed += 1;
      }
    }
  }
  return removed;
}

setInterval(() => pruneExpiredSessions(), 60_000).unref();
