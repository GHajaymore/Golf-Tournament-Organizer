import { describe, expect, it } from "vitest";
import { clubZoneFor, defaultClubZone } from "../../../e2e/club-zone";
import { readSource } from "./source";

/**
 * B120: an e2e club made with no options has a time zone.
 *
 * A club with none makes the console layout draw `ClubClockAdopter`, whose mount-time server action
 * revalidates the whole layout and re-renders the first page a few hundred ms later, racing any spec that
 * writes to the database and expects a stale screen (the completed-offers WebKit failure, #1240).
 */
describe("e2e clubs are born in a time zone", () => {
  it("takes E2E_TZ when a run sets it, else the machine's zone", () => {
    expect(defaultClubZone({ E2E_TZ: "Pacific/Auckland" }, "UTC")).toBe("Pacific/Auckland");
    expect(defaultClubZone({}, "America/Chicago")).toBe("America/Chicago");
    expect(defaultClubZone({ E2E_TZ: "" }, "Europe/London")).toBe("Europe/London");
  });

  it("the real default is a zone the browser can name, never empty", () => {
    const zone = defaultClubZone();
    expect(zone).not.toBe("");
    expect(() => new Intl.DateTimeFormat("en", { timeZone: zone })).not.toThrow();
  });

  it("an omitted option gets the default, a named one is kept, null opts out", () => {
    expect(clubZoneFor(undefined)).toBe(defaultClubZone());
    expect(clubZoneFor(undefined)).not.toBe("");
    expect(clubZoneFor("Europe/London")).toBe("Europe/London");
    expect(clubZoneFor(null)).toBe("");
  });

  it("makeClub writes the zone through clubZoneFor and never falls back to an empty one", () => {
    const src = readSource("e2e", "rounds-fixture.ts");
    expect(src).toContain("timeZone: clubZoneFor(opts.timeZone)");
    expect(src).not.toMatch(/timeZone:\s*opts\.timeZone\s*\?\?\s*""/);
  });
});
