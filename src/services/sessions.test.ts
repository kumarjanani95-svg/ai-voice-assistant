import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildSummary,
  createSession,
  deleteSession,
  emptySlots,
  getOrCreateSession,
  loadSessionFromDisk,
  persistSession,
} from "./sessions.js";

describe("conversation memory", () => {
  it("keeps the same session id across turns", () => {
    const first = createSession();
    first.messages.push({ role: "user", content: "Book a ride from Marina" });
    const again = getOrCreateSession(first.id);
    assert.equal(again.id, first.id);
    assert.equal(again.messages[0]?.content, "Book a ride from Marina");
    deleteSession(first.id);
  });

  it("persists previous conversation to disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otovoice-"));
    const slots = emptySlots();
    slots.pickup = { raw: "marina", formatted: null, lat: null, lng: null };
    const session = {
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        { role: "user" as const, content: "Pickup at Marina" },
        { role: "assistant" as const, content: "Where are you going?" },
      ],
      slots,
      lastIntent: "set_pickup" as const,
      pendingActions: [],
      awaitingResults: [],
      pendingLocation: null,
      summary: "",
    };
    session.summary = buildSummary(session);
    persistSession(session, dir);

    const loaded = loadSessionFromDisk(session.id, dir);
    assert.equal(loaded?.slots.pickup?.raw, "marina");
    assert.equal(loaded?.messages.length, 2);
    assert.match(loaded?.summary ?? "", /Marina/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
