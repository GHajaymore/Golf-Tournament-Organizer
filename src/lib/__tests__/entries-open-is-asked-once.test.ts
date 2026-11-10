import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { entriesChange, entriesOpen, formatDeadline, type RegistrationInput } from "../registration";
import { decideIntake } from "../domain/registration-intake";

/**
 * ARE ENTRIES OPEN? IS ASKED ONCE (the entries cleanup, 2026-11-05).
 *
 * Two facts decide it — whether the sign-up link is published, and what the
 * dates, capacity and the organizer's override say — and five controls used to
 * hold them. `entriesOpen` joins them; this holds its answers to the Rules of
 * the office (a notice that has not gone out takes nobody; the opening day is
 * open; the deadline day is open until the club's midnight), and refuses a
 * second place that joins the two by hand.
 */

const at = (iso: string) => new Date(`${iso}T12:00:00`);

const reg = (over: Partial<RegistrationInput> = {}): RegistrationInput => ({
  eventStatus: "registration",
  deadline: "2026-06-14",
  opens: "",
  capacity: 0,
  confirmedCount: 0,
  override: null,
  now: at("2026-06-01"),
  ...over,
});
const asked = (over: Partial<RegistrationInput> = {}, registrationOpen = true) => entriesOpen({ ...reg(over), registrationOpen });

describe("entriesOpen: one state, one button", () => {
  it("a link nobody has published is Not open, with Open entries as its one button", () => {
    const e = asked({}, false);
    expect(e.open).toBe(false);
    expect(e.state).toBe("not-published");
    expect(e.label).toBe("Not open");
    expect(e.action).toEqual({ do: "open", label: "Open entries" });
  });

  it("a published link inside the window is open, and its one button closes", () => {
    const e = asked();
    expect(e.open).toBe(true);
    expect(e.state).toBe("open");
    expect(e.action).toEqual({ do: "close", label: "Close entries" });
    expect(e.line).toContain("Entries are open until");
  });

  it("before the opening day it is Opens soon, and the button opens them now", () => {
    const e = asked({ opens: "2026-06-10" });
    expect(e.open).toBe(false);
    expect(e.state).toBe("not-open-yet");
    expect(e.action).toEqual({ do: "open", label: "Open entries now" });
  });

  it("the deadline day is open; the day after it is closed and offers Reopen entries", () => {
    expect(asked({ now: at("2026-06-14") }).open).toBe(true);
    const after = asked({ now: at("2026-06-15") });
    expect(after.open).toBe(false);
    expect(after.state).toBe("closed-deadline");
    expect(after.action).toEqual({ do: "open", label: "Reopen entries" });
  });

  it("a full field is open: it waitlists", () => {
    const e = asked({ capacity: 4, confirmedCount: 4 });
    expect(e.open).toBe(true);
    expect(e.status.waitlisting).toBe(true);
  });

  it("closed by the organizer is closed even with the link up", () => {
    expect(asked({ override: true }).open).toBe(false);
  });

  it("a finished tournament is closed and has no button, whatever the link says", () => {
    const e = asked({ eventStatus: "completed", override: false });
    expect(e.open).toBe(false);
    expect(e.action).toBeNull();
  });

  it("the intake a stranger meets agrees with it, in every state", () => {
    const cases: Array<[Partial<RegistrationInput>, boolean]> = [
      [{}, true], [{}, false], [{ opens: "2026-06-10" }, true], [{ now: at("2026-06-15") }, true],
      [{ override: true }, true], [{ override: false, now: at("2026-06-15") }, true],
      [{ capacity: 2, confirmedCount: 2 }, true], [{ eventStatus: "completed" }, true],
    ];
    for (const [over, link] of cases) {
      const decision = decideIntake({ registrationOpen: link, approvalMode: "auto", reg: reg(over) });
      expect(decision.accepted, JSON.stringify([over, link])).toBe(entriesOpen({ ...reg(over), registrationOpen: link }).open);
    }
  });
});

describe("entriesChange: what the one button writes", () => {
  const ok = (r: ReturnType<typeof entriesChange>) => {
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  it("the first Open entries publishes the link and leaves the dates their say", () => {
    expect(entriesChange(true, reg(), false)).toEqual({ ok: true, registrationOpen: true, registrationOverride: null, clearOpens: false });
    // Even before the opening day: the dates rule, so it reads Opens soon and the closing day still holds.
    expect(entriesChange(true, reg({ opens: "2026-06-10" }), false)).toEqual({ ok: true, registrationOpen: true, registrationOverride: null, clearOpens: false });
    expect(entriesOpen({ ...reg({ opens: "2026-06-10" }), registrationOpen: true }).state).toBe("not-open-yet");
  });
  it("Open entries now, before the opening day, clears the opening day and keeps the closing day", () => {
    expect(entriesChange(true, reg({ opens: "2026-06-10" }), true)).toEqual({ ok: true, registrationOpen: true, registrationOverride: null, clearOpens: true });
  });
  it("opening early does NOT switch the closing day off (the review's bug)", () => {
    const c = ok(entriesChange(true, reg({ opens: "2026-06-10" }), true));
    const after = { ...reg({ opens: c.clearOpens ? "" : "2026-06-10", override: c.registrationOverride }), registrationOpen: true };
    expect(entriesOpen(after).open, "open now").toBe(true);
    expect(entriesOpen({ ...after, now: at("2026-06-15") }).open, "the day after the closing day").toBe(false);
    expect(entriesOpen({ ...after, now: at("2026-06-15") }).state).toBe("closed-deadline");
  });
  it("reopening a published link past the closing day keeps it open", () => {
    expect(entriesChange(true, reg({ now: at("2026-06-20"), override: true }), true)).toEqual({ ok: true, registrationOpen: true, registrationOverride: false, clearOpens: false });
  });
  it("reopening something the organizer closed hands it back to the dates", () => {
    expect(entriesChange(true, reg({ override: true }), true)).toEqual({ ok: true, registrationOpen: true, registrationOverride: null, clearOpens: false });
  });
  it("closing keeps the link and says closed by the organizer, so a visitor is told", () => {
    expect(entriesChange(false, reg({ override: false }), true)).toEqual({ ok: true, registrationOpen: null, registrationOverride: true, clearOpens: false });
    const e = entriesOpen({ ...reg({ override: true }), registrationOpen: true });
    expect(e.open).toBe(false);
    expect(e.state).toBe("closed-manual");
    expect(e.line).toBe("Closed by you. Reopen entries to take more.");
    const late = entriesOpen({ ...reg({ now: at("2026-06-15") }), registrationOpen: true });
    expect(late.line).toBe(`Closed after ${formatDeadline("2026-06-14")}, the closing day. Reopen entries to take more.`);
    expect(late.line, "the two closed states read the same").not.toBe(e.line);
  });
  it("a finished tournament cannot be opened", () => {
    expect(entriesChange(true, reg({ eventStatus: "completed" }), true).ok).toBe(false);
  });
  it("pressing the button's own action ends up open (the first press before the opening day reads Opens soon)", () => {
    const cases: Array<[Partial<RegistrationInput>, boolean]> = [
      [{}, false], [{ opens: "2026-06-10" }, false], [{ opens: "2026-06-10" }, true],
      [{ now: at("2026-06-20") }, true], [{ override: true }, true], [{ capacity: 1, confirmedCount: 1 }, true],
    ];
    for (const [over, published] of cases) {
      const c = ok(entriesChange(true, reg(over), published));
      const e = entriesOpen({ ...reg(over), opens: c.clearOpens ? "" : (over.opens ?? ""), override: c.registrationOverride, registrationOpen: c.registrationOpen ?? true });
      const expected = !(!published && over.opens);
      expect(e.open, JSON.stringify([over, published])).toBe(expected);
    }
  });
});

/** Every non-test source file under src. */
function sources(dir = "src", out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") sources(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

/** Files that put the link and the dates' verdict into ONE condition. */
function joinsByHand(src: string): boolean {
  return /acceptingEntries[^\n;]{0,80}registrationOpen|registrationOpen[^\n;]{0,80}acceptingEntries/.test(src);
}

describe("nobody joins the link and the dates by hand", () => {
  it("only registration.ts does", () => {
    const offenders = sources().filter((f) => f !== "src/lib/registration.ts" && joinsByHand(readSource(f)));
    expect(offenders, "ask `entriesOpen(...).open` instead").toEqual([]);
  });

  it("control: the sweep sees the spelling it bans", () => {
    expect(joinsByHand("const canEnter = status.acceptingEntries && event.registrationOpen;")).toBe(true);
    expect(joinsByHand("const canEnter = event.registrationOpen && status.acceptingEntries;")).toBe(true);
    expect(joinsByHand("const canEnter = entriesOpen(x).open;")).toBe(false);
  });

  it("the public sign-up, the intake and the member's list all read it", () => {
    expect(readSource("src/lib/domain/registration-intake.ts")).toMatch(/entriesOpen\(/);
    expect(readSource("src/lib/services/club-events.ts")).toMatch(/entriesOpen\(/);
  });
});

describe("the entry terms are saved from Entries, together", () => {
  const src = readSource("src/app/actions/tournament.ts");
  const fn = (name: string) => {
    const start = src.indexOf(`export async function ${name}`);
    const next = src.indexOf("\nexport ", start + 1);
    return src.slice(start, next === -1 ? undefined : next);
  };

  it("saveEntryTerms is admin and lock-gated, as saveEvent was when it carried them", () => {
    const body = fn("saveEntryTerms");
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/requireAdminEvent\(\)/);
    // The field's scoped lock, returned (state machine PR 5b).
    expect(body).toMatch(/await refuseIfLocked\(eventId, "field", /);
    expect(body).toMatch(/drainWaitlist\(/);
    expect(body).toMatch(/closes < opens/);
  });

  it("saveEvent no longer carries the window or the capacity", () => {
    const body = fn("saveEvent");
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toMatch(/regDeadline|regOpens|capacity:/);
  });

  it("setEntriesOpen is told the club's day", () => {
    const body = fn("setEntriesOpen");
    expect(body).toMatch(/clubDayForEvent\(/);
    expect(body).not.toMatch(/new Date\(/);
    expect(body).toMatch(/entriesChange\(/);
  });

  it("refuses a payload that is not a boolean, in words, rather than closing entries", () => {
    const body = fn("setEntriesOpen");
    expect(body).toMatch(/typeof open !== "boolean"/);
    expect(body).not.toMatch(/open === true/);
  });

  it("the report reads the real link column, not a hard-coded true", () => {
    expect(readSource("src/lib/services/event-report-sections.ts")).not.toMatch(/registrationOpen: true,\s*\n\s*eventStatus/);
  });

  it("the two switches it replaced are gone", () => {
    expect(src).not.toMatch(/export async function setRegistrationOverride/);
    expect(src).not.toMatch(/export async function setRegistrationOpen\b/);
  });
});
