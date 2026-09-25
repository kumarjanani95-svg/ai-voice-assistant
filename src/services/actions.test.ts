import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptySlots } from "./sessions.js";
import { applyActionResult, deriveActions } from "./actions.js";
import { buildAction } from "../catalog/actions.js";

describe("deriveActions", () => {
  it("never invents a booking when places are unresolved", () => {
    const slots = emptySlots();
    slots.pickup = { raw: "home", formatted: null, lat: null, lng: null };
    slots.destination = { raw: "airport", formatted: null, lat: null, lng: null };

    const actions = deriveActions({
      intentName: "request_ride",
      slots,
      suggested: ["create_booking"],
      pending: [],
    });

    assert.equal(actions.some((action) => action.name === "create_booking"), false);
    assert.equal(actions.filter((action) => action.name === "geocode").length, 2);
  });

  it("proposes an approval-gated booking only after coordinates exist", () => {
    const slots = emptySlots();
    slots.pickup = { raw: "home", formatted: "Home", lat: 25.2, lng: 55.27 };
    slots.destination = { raw: "airport", formatted: "DXB", lat: 25.25, lng: 55.36 };

    const actions = deriveActions({
      intentName: "request_ride",
      slots,
      suggested: [],
      pending: [],
    });

    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.name, "create_booking");
    assert.equal(actions[0]?.target, "laravel");
    assert.equal(actions[0]?.requiresApproval, true);
    assert.equal(actions[0]?.confirmed, false);
  });

  it("confirms a pending action without calculating a fare", () => {
    const pending = [buildAction("create_booking", { pickup: "A", destination: "B" })];
    const actions = deriveActions({
      intentName: "confirm",
      slots: emptySlots(),
      suggested: [],
      pending,
    });

    assert.equal(actions[0]?.confirmed, true);
    assert.equal(actions.some((action) => action.name === "fare_estimate"), false);
  });
});

describe("applyActionResult", () => {
  it("merges geocode coordinates into the matching slot", () => {
    const slots = emptySlots();
    slots.pickup = { raw: "marina", formatted: null, lat: null, lng: null };
    const action = buildAction("geocode", { role: "pickup", query: "marina" });

    const next = applyActionResult(slots, action, {
      formatted: "Dubai Marina",
      lat: 25.08,
      lng: 55.14,
    });

    assert.equal(next.pickup?.formatted, "Dubai Marina");
    assert.equal(next.pickup?.lat, 25.08);
    assert.equal(next.pickup?.lng, 55.14);
  });
});
