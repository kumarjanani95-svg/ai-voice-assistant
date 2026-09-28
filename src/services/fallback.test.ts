import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fallbackExtract } from "./fallback.js";

describe("fallbackExtract", () => {
  it("extracts pickup and destination from a ride request", () => {
    const result = fallbackExtract("Book a ride from Marina to the airport");
    assert.equal(result.intentName, "request_ride");
    assert.equal(result.slotUpdates.pickup?.raw, "marina");
    assert.match(String(result.slotUpdates.destination?.raw), /airport/i);
    assert.equal(result.slotUpdates.bookingRef, null);
  });

  it("uses device coordinates when the rider says here", () => {
    const result = fallbackExtract("Pick me up from here", {
      currentLat: 25.2,
      currentLng: 55.27,
    });
    assert.equal(result.slotUpdates.pickup?.lat, 25.2);
    assert.equal(result.slotUpdates.pickup?.lng, 55.27);
  });

  it("remembers a previous pickup when the rider only names a destination", () => {
    const known = {
      pickup: { raw: "marina", formatted: null, lat: null, lng: null },
      destination: null,
      when: null,
      vehicleType: null,
      bookingRef: null,
    };
    const result = fallbackExtract("the airport", undefined, {
      slots: known,
      lastIntent: "set_pickup",
    });
    assert.equal(result.intentName, "set_destination");
    assert.match(String(result.slotUpdates.destination?.raw), /airport/i);
  });

  it("uses remembered places when the rider says book a ride", () => {
    const result = fallbackExtract("book a ride", undefined, {
      slots: {
        pickup: { raw: "marina", formatted: null, lat: null, lng: null },
        destination: { raw: "airport", formatted: null, lat: null, lng: null },
        when: null,
        vehicleType: null,
        bookingRef: null,
      },
    });
    assert.equal(result.intentName, "request_ride");
    assert.deepEqual(result.missingSlots, []);
    assert.match(result.replyText, /marina/i);
  });

  it("treats a numbered answer as a location choice", () => {
    const result = fallbackExtract("2", undefined, {
      pendingLocation: {
        role: "pickup",
        query: "Marina",
        suggestions: [
          {
            index: 2,
            label: "Marina Promenade",
            formatted: "Marina Promenade",
            lat: 25.08,
            lng: 55.14,
            kind: "exact",
            type: "place:exact",
          },
        ],
      },
    });
    assert.equal(result.intentName, "choose_location");
  });

  it("confirms a pending pickup instead of booking", () => {
    const result = fallbackExtract("yes, proceed", undefined, {
      pendingPickupConfirm: true,
      slots: {
        pickup: { raw: "marina mall", formatted: "Dubai Marina Mall", lat: 25.07, lng: 55.14 },
        destination: null,
        when: null,
        vehicleType: null,
        bookingRef: null,
      },
    });
    assert.equal(result.intentName, "confirm");
  });

  it("treats a new place as a pickup change while confirming", () => {
    const result = fallbackExtract("Marina Walk", undefined, {
      pendingPickupConfirm: true,
      slots: {
        pickup: { raw: "marina mall", formatted: "Dubai Marina Mall", lat: 25.07, lng: 55.14 },
        destination: null,
        when: null,
        vehicleType: null,
        bookingRef: null,
      },
    });
    assert.equal(result.intentName, "set_pickup");
    assert.match(String(result.slotUpdates.pickup?.raw), /marina walk/i);
  });
});
