import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAreaHit } from "./geocode.js";
import { applyLocationChoice, classifyPickupConfirmReply, formatPickupConfirmReply, parseSuggestionChoice, sanitizePlaceQuery } from "./location.js";

describe("location classification", () => {
  it("treats a city or suburb as an area", () => {
    assert.equal(isAreaHit({ type: "suburb", className: "place" }), true);
    assert.equal(isAreaHit({ type: "city", className: "place" }), true);
    assert.equal(isAreaHit({ type: "administrative", className: "boundary" }), true);
  });

  it("treats a building or amenity as exact", () => {
    assert.equal(isAreaHit({ type: "mall", className: "shop" }), false);
    assert.equal(isAreaHit({ type: "hotel", className: "tourism" }), false);
    assert.equal(isAreaHit({ addresstype: "house" }), false);
  });
});

describe("suggestion choice", () => {
  const pending = {
    role: "pickup" as const,
    query: "Marina",
    suggestions: [
      {
        index: 1,
        label: "Dubai Marina Mall",
        formatted: "Dubai Marina Mall, Dubai",
        lat: 25.076,
        lng: 55.14,
        kind: "exact" as const,
        type: "shop:mall",
      },
      {
        index: 2,
        label: "Marina Promenade",
        formatted: "Marina Promenade, Dubai",
        lat: 25.08,
        lng: 55.141,
        kind: "exact" as const,
        type: "highway:pedestrian",
      },
    ],
  };

  it("reads a numbered choice", () => {
    assert.equal(parseSuggestionChoice("2"), 2);
    assert.equal(parseSuggestionChoice("number 1"), 1);
    assert.equal(parseSuggestionChoice("the second one"), 2);
  });

  it("applies the chosen suggestion coordinates", () => {
    const place = applyLocationChoice(pending, "1");
    assert.equal(place?.formatted, "Dubai Marina Mall, Dubai");
    assert.equal(place?.lat, 25.076);
    assert.equal(place?.lng, 55.14);
  });

  it("matches a spoken place name to a suggestion", () => {
    const place = applyLocationChoice(pending, "marina mall");
    assert.equal(place?.formatted, "Dubai Marina Mall, Dubai");
  });
});

describe("pickup confirmation", () => {
  it("asks to proceed or change the pickup", () => {
    const reply = formatPickupConfirmReply({
      raw: "marina mall",
      formatted: "Dubai Marina Mall",
      lat: 25.07,
      lng: 55.14,
    });
    assert.match(reply, /Dubai Marina Mall/);
    assert.match(reply, /proceed/i);
    assert.match(reply, /change/i);
  });

  it("classifies proceed and change answers", () => {
    assert.equal(classifyPickupConfirmReply("yes"), "proceed");
    assert.equal(classifyPickupConfirmReply("proceed"), "proceed");
    assert.equal(classifyPickupConfirmReply("change it"), "change");
    assert.equal(classifyPickupConfirmReply("no"), "change");
  });
});

describe("query cleanup", () => {
  it("strips pickup phrasing from a place query", () => {
    assert.equal(sanitizePlaceQuery("pick me up from Dubai Marina Mall"), "Dubai Marina Mall");
    assert.equal(sanitizePlaceQuery("from Marina"), "Marina");
  });
});
