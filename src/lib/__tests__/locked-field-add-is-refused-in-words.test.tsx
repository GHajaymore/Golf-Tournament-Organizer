import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import { NO_SHEET, OPEN_DOORS, liveDoors } from "./field-doors";
import { fieldBanner } from "@/lib/domain/field-change";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
function actionModule() {
  return new Proxy(
    {},
    { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) },
  ) as Record<string, unknown>;
}
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/roster", actionModule);
vi.mock("@/app/actions/messaging", actionModule);
vi.mock("@/app/actions/event", actionModule);

/**
 * THE ENTRIES SCREEN AFTER LAUNCH — what is open and what is shut, drawn from
 * the one field rule (day-of field changes, PR A).
 *
 * Its history: walked as the secretary on the live April Medal, 2026-09-27,
 * the "Add someone new" form was the one control not gated on the lock, and
 * `addSignup` refused by THROWING ("Application error"), under a banner that
 * promised "You can still add players below". Then every field control shut
 * at launch — including Withdraw, so on the morning an Assistant could not
 * record one name off the sheet.
 *
 * Now the screen takes the field's DOORS (`fieldDoors`), the same verdicts the
 * actions ask: under way in a stroke field, Add, Withdraw and the roster picker
 * stay open; the CSV import and players' details stay shut with the reason
 * beside them; a drawn field (a knockout) refuses Add in the rule's words.
 */
const row = (id: string, name: string) => ({
  id, name, handicap: 10, handicapType: "18", handicapSource: "manual", seed: 1, email: `${id}@example.invalid`, phone: "",
});

const reg = async (opts: {
  locked: boolean;
  doors: typeof OPEN_DOORS;
  underWay?: string[] | null;
  flights?: Array<{ id: string; label: string }>;
  unplacedFlag?: string;
  addFlight?: "offered" | "required" | null;
  offerReserve?: boolean;
}) => {
  const { RegistrationClient } = await import("@/components/RegistrationClient");
  return renderToStaticMarkup(
    <RegistrationClient teesDoor={null}
      confirmed={[row("p1", "zz-Ann Doyle")]} waitlist={[]} pendingEntries={[]} isAdmin
      roster={[{ id: "m1", name: "zz-Cleo Green", email: "m1@example.invalid", phone: "", handicap: 12, entered: false } as never]}
      locked={opts.locked} doors={opts.doors} underWay={opts.underWay ?? null} flights={opts.flights ?? []}
      unplacedFlag={opts.unplacedFlag ?? ""} addFlight={opts.addFlight ?? null} offerReserve={opts.offerReserve ?? false}
      event={{
        name: "zz-April Medal", capacity: 32, status: "live", regDeadline: "", regOpens: "", today: "2026-06-01",
        // Closed by hand (true is "closed"), with the link published: the state
        // in which the card offers "add below" (and, refused, says it cannot).
        registrationOverride: true, inviteMessage: "", organizationName: "zz-Club",
        dates: "", course: "", city: "", registrationOpen: true, registrationApproval: "auto",
        requirePhone: false, registrationToken: "",
      }} />,
  );
};

/** The opening tag of the element whose text (or accessible name) is `marker`. */
function tagBefore(html: string, marker: string, tag = "button"): string {
  const at = html.indexOf(marker);
  expect(at, `${marker} should be on the screen`).toBeGreaterThan(-1);
  const open = html.lastIndexOf(`<${tag}`, at);
  return html.slice(open, html.indexOf(">", open) + 1);
}
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

describe("Entries under way in a stroke field: the day-of doors are open", () => {
  const doors = liveDoors("stroke");
  const underWay = fieldBanner({ status: "live", configUnlocked: false, correction: null, family: "stroke", playedRound: null, flightsConfirmed: false, flights: 0, knockoutDrawn: false, ...NO_SHEET });

  it("says it is under way and what is still open, not 'Setup locked'", async () => {
    const html = await reg({ locked: true, doors, underWay });
    expect(html).toContain("Under way");
    expect(html).toContain("You can withdraw a player, put one back or add a late entry");
    expect(html).not.toContain("Setup locked");
  });

  it("Add, Withdraw and the roster picker are live; the CSV import and details are not, with the reason beside them", async () => {
    const html = await reg({ locked: true, doors, underWay });
    // Add: the late-entry button is not disabled by the field (only by the empty name box).
    const add = tagBefore(html, "Add late entry");
    expect(add).toContain("disabled");
    expect(html).not.toContain(doors.add ?? "THE ADD DOOR IS OPEN");
    // Withdraw: the per-row button, named for the act, enabled.
    // The WHOLE opening tag: `disabled` may come after the title (a slice up to the title missed it).
    const withdraw = tagBefore(html, 'title="Withdraw zz-Ann Doyle"');
    expect(withdraw).toMatch(/^<button[^>]*>$/);
    expect(isDisabled(withdraw)).toBe(false);
    // The CSV import: shut, and why.
    expect(html).toMatch(/type="file"[^>]*disabled=""/);
    expect(html).toContain(doors.bulk!);
    // Details (the email box): shut.
    expect(isDisabled(tagBefore(html, 'aria-label="Email for zz-Ann Doyle"', "input"))).toBe(true);
    // The promise above the form is true again: a stroke field takes a late entry.
    expect(html).toContain("You can still add players below");
  });

  it("the Add button's only refusal is the empty form (the control: a name typed would enable it)", () => {
    const src = readSource("src", "components", "RegistrationClient.tsx");
    const at = src.indexOf("onClick={() => submitAdd()}");
    const button = src.slice(src.lastIndexOf("<button", at), at);
    // The door the press asks: the add door, or — with a flight chosen in the form — the add-with-a-flight door (J12).
    expect(button).toMatch(/disabled=\{pending \|\| !!addRefusal \|\|/);
    expect(src).toMatch(/const addRefusal = addFlight && addFlightId \? doors\["add-to-flight"\] : doors\.add;/);
    expect(src).toMatch(/type="file"[^>]*onChange=\{onFile\} disabled=\{pending \|\| !!doors\.bulk\}/);
    // The roster picker beside it follows the same add door, not the setup lock.
    expect(src).toMatch(/<RosterPicker [^>]*locked=\{!!doors\.add\}/);
  });
});

describe("Entries under way in a knockout: the draw is the field", () => {
  const doors = liveDoors("knockout");

  it("refuses Add in the rule's words where the button is, and promises nothing", async () => {
    const html = await reg({ locked: true, doors, underWay: ["x"] });
    expect(isDisabled(tagBefore(html, "Add late entry"))).toBe(true);
    expect(html).toContain(
      "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. An Organizer can open the field with a committee correction.",
    );
    expect(html).not.toContain("You can still add players below");
    expect(html).toContain("While it is closed the sign-up link turns everyone away.");
    // Withdraw is still open: a withdrawal never reopens anything.
    expect(isDisabled(tagBefore(html, 'title="Withdraw zz-Ann Doyle"'))).toBe(false);
  });

  it("after the first card a stroke field refuses Add, naming the round and who can unlock", async () => {
    const html = await reg({ locked: true, doors: liveDoors("stroke", "Round 1"), underWay: ["x"] });
    expect(html).toContain(
      "The first card of Round 1 is in, so late entries are closed. To add someone anyway, an Organizer can make a committee correction to the field on the dashboard.",
    );
  });
});

/**
 * A CONFIRMED DRAW DOES NOT SHUT "CHOOSE A FLIGHT" FOR A LATE ENTRANT in stroke
 * play or Stableford (panel review of #1028, must-fix 1): placing an unplaced
 * player moves nobody. The control: where flights make the pairings (a round
 * robin) the confirmed draw does shut it, and so does the first card.
 */
describe("Entries under way with a confirmed draw: a late entrant can still be given a flight", () => {
  const flights = [{ id: "g1", label: "Flight A" }, { id: "g2", label: "Flight B" }];
  const chooser = 'aria-label="Flight for zz-Ann Doyle"';

  for (const family of ["stroke", "stableford"] as const) {
    it(`${family}: "Choose a flight" is offered and live`, async () => {
      const html = await reg({ locked: true, doors: liveDoors(family, null, true), underWay: ["x"], flights });
      expect(isDisabled(tagBefore(html, chooser, "select"))).toBe(false);
      expect(html).toContain("Choose a flight");
    });
  }

  it("CONTROL: a round robin's confirmed draw, or a first card, shuts it", async () => {
    const robin = await reg({ locked: true, doors: liveDoors("roundRobinFlights", null, true), underWay: ["x"], flights });
    expect(robin).not.toContain(chooser);
    const begun = await reg({ locked: true, doors: liveDoors("stroke", "Round 1", true), underWay: ["x"], flights });
    expect(begun).not.toContain(chooser);
  });
});

describe("Entries before launch (the control)", () => {
  it("everything is open and the old words stand", async () => {
    const html = await reg({ locked: false, doors: OPEN_DOORS });
    expect(html).toContain("You can still add players below");
    expect(html).not.toContain("Under way");
    expect(html).toContain("Add to field");
    expect(html).toContain('title="Remove zz-Ann Doyle from the field"');
    expect(isDisabled(tagBefore(html, 'aria-label="Email for zz-Ann Doyle"', "input"))).toBe(false);
  });
});

describe("the actions ask the one rule, in words", () => {
  const src = readSource("src", "app", "actions", "tournament.ts");
  const body = (name: string, len = 2500) => src.slice(src.indexOf(`export async function ${name}(`), src.indexOf(`export async function ${name}(`) + len);

  it("addSignup and importCsvSignups return the rule's refusal rather than throwing", () => {
    // The whole verdict since J12 (PR 7a): an entry, an entry with a flight, or a reserve — refused in the rule's words.
    expect(body("addSignup", 5000)).toMatch(
      /const verdict = await fieldVerdictFor\(eventId, reserve \? "reserve" : flightId \? "add-to-flight" : "add"\);\s*if \(!verdict\.ok\) return \{ ok: false, error: verdict\.says \};/,
    );
    expect(body("addSignup")).not.toMatch(/assertUnlocked|configurationLocked/);
    expect(body("importCsvSignups", 900)).toMatch(/fieldRefusal\(eventId, "bulk"\)/);
    expect(body("importCsvSignups", 900)).not.toMatch(/assertUnlocked|configurationLocked/);
  });
});

/**
 * THE UPSTREAM-CHANGE RULES ON ENTRIES (J12, state machine PR 7a), each family
 * as the desk sees it. The doors are the one rule's (`liveDoors`); the
 * screen's own props (`addFlight`, `offerReserve`, `unplacedFlag`) are the
 * page's readings of the same rule, given here as the page would give them.
 */
describe("Entries under way, by family: the flag, the flight, the reserve (J12)", () => {
  const flights = [{ id: "g1", label: "Flight A" }, { id: "g2", label: "Flight B" }];

  it("stroke: a late entrant in no flight is flagged in the panel's words, and the add form offers a flight without forcing one", async () => {
    const html = await reg({
      locked: true,
      doors: liveDoors("stroke"),
      underWay: ["x"],
      flights,
      addFlight: "offered",
      unplacedFlag: "zz-Sam Reed is in the field but in no flight. Put them in one.",
    });
    expect(html).toContain("zz-Sam Reed is in the field but in no flight. Put them in one.");
    expect(html).toContain("· optional");
    expect(html).toContain("No flight yet");
    // Not forced: nothing says a flight is needed.
    expect(html).not.toContain("In a round robin, a late entrant needs a flight.");
  });

  it("round robin: the flight is required — Add says why where it is, until one is chosen", async () => {
    const html = await reg({ locked: true, doors: liveDoors("roundRobinFlights"), underWay: ["x"], flights, addFlight: "required" });
    expect(html).toContain("· required in a round robin");
    expect(html).toContain("Choose a flight");
    expect(isDisabled(tagBefore(html, "Add late entry"))).toBe(true);
    expect(html).toContain("In a round robin, a late entrant needs a flight. Without one they have no matches. Choose their flight in the Add form.");
  });

  it("knockout: Add is refused with the reserve as the way out, and Add as a reserve is one press away", async () => {
    const html = await reg({ locked: true, doors: liveDoors("knockout"), underWay: ["x"], offerReserve: true });
    expect(html).toContain("Add as a reserve");
    expect(html).toContain("Add them as a reserve: they wait on the waiting list.");
    // No flight in a knockout's add form.
    expect(html).not.toContain("No flight yet");
  });

  it("CONTROL: before launch nothing is flagged, nothing required, no reserve offered", async () => {
    const html = await reg({ locked: false, doors: OPEN_DOORS });
    expect(html).not.toContain("in no flight");
    expect(html).not.toContain("Add as a reserve");
    expect(html).not.toContain("required in a round robin");
  });
});
