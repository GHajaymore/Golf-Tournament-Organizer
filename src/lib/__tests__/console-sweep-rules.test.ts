import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { navForRole } from "../nav";
import {
  judge, isReason, isSaveState, isPagerEnd, gap, scrub, keyOf, ratchet, knownFile, knownFor, stageFor, ASSISTANT_STAGE_PREFIX,
  KEY_SHAPE, REASON_WITHIN_PX, SWEEP_WIDTH, RULES,
  type Facts, type DisabledControl,
} from "../../../e2e/console-sweep";

/**
 * THE CONSOLE SWEEP'S RULES, HELD WITHOUT A BROWSER (J51).
 *
 * `e2e/console-sweep.spec.ts` walks the organizer's screens and judges each
 * with `judge`, on facts a browser collected. The judging is pure, so it is
 * held here on facts written by hand: each rule at its edge (one pixel either
 * side), each way of giving a reason, the one exemption, and the ratchet. The
 * spec's own controls prove the half this cannot: that a real page's facts are
 * collected at all.
 *
 * And the known list is held to its shape, so a paste from a CI log that
 * dropped a quote or doubled a line fails here, in seconds, not in a round.
 */
const at = (x: number, y: number, w = 100, h = 34) => ({ x, y, w, h });
const control = (over: Partial<DisabledControl> = {}): DisabledControl => ({
  sig: "button.btn.btn-secondary", label: "Delete round", tag: "button", box: at(0, 100), describedBy: [], ...over,
});
const facts = (over: Partial<Facts> = {}): Facts => ({ scrollWidth: SWEEP_WIDTH, disabled: [], texts: [], primaries: [], ...over });
const rules = (f: Facts, names: string[] = []) => judge(f, { width: SWEEP_WIDTH, names }).map((v) => v.rule);
const SENTENCE = "Round 1 has scores, so it cannot be deleted.";

describe("the console sweep's rules", () => {
  it("a clean page breaks nothing", () => {
    expect(judge(facts(), { width: SWEEP_WIDTH })).toEqual([]);
  });

  it("rule 1: wider than the screen by more than a pixel is sideways scroll", () => {
    expect(rules(facts({ scrollWidth: 400 }))).toEqual(["sideways-scroll"]);
    expect(rules(facts({ scrollWidth: SWEEP_WIDTH + 2 }))).toEqual(["sideways-scroll"]);
    expect(rules(facts({ scrollWidth: SWEEP_WIDTH + 1 }))).toEqual([]);
    // The width is what was asked for, not what the page says of itself.
    expect(judge(facts({ scrollWidth: 400 }), { width: 400 })).toEqual([]);
  });

  it("rule 2: a disabled control with nothing said is a finding, named by what it is", () => {
    const found = judge(facts({ disabled: [control()] }), { width: SWEEP_WIDTH });
    expect(found.map((v) => v.rule)).toEqual(["disabled-without-reason"]);
    expect(found[0].sig).toBe('button.btn.btn-secondary "Delete round"');
  });

  it("rule 2: aria-describedby is a reason only when what it names is drawn and has words", () => {
    expect(rules(facts({ disabled: [control({ describedBy: [SENTENCE] })] }))).toEqual([]);
    expect(rules(facts({ disabled: [control({ describedBy: [""] })] }))).toEqual(["disabled-without-reason"]);
    expect(rules(facts({ disabled: [control({ describedBy: ["", "  "] })] }))).toEqual(["disabled-without-reason"]);
    expect(rules(facts({ disabled: [control({ describedBy: ["", SENTENCE] })] }))).toEqual([]);
  });

  it(`rule 2: a sentence within ${REASON_WITHIN_PX}px is a reason, and one pixel further is not`, () => {
    const c = control({ box: at(0, 100, 100, 34) });
    const below = (dy: number) => ({ text: SENTENCE, box: at(0, 134 + dy, 300, 18) });
    expect(rules(facts({ disabled: [c], texts: [below(4)] }))).toEqual([]);
    expect(rules(facts({ disabled: [c], texts: [below(REASON_WITHIN_PX)] }))).toEqual([]);
    expect(rules(facts({ disabled: [c], texts: [below(REASON_WITHIN_PX + 1)] }))).toEqual(["disabled-without-reason"]);
    // Above, and beside, count the same; and the distance can be set.
    expect(rules(facts({ disabled: [c], texts: [{ text: SENTENCE, box: at(0, 60, 300, 18) }] }))).toEqual([]);
    expect(rules(facts({ disabled: [c], texts: [{ text: SENTENCE, box: at(110, 100, 200, 18) }] }))).toEqual([]);
    expect(judge(facts({ disabled: [c], texts: [below(40)] }), { width: SWEEP_WIDTH, within: 20 }).map((v) => v.rule)).toEqual(["disabled-without-reason"]);
  });

  it("rule 2: words that are not a sentence are not a reason, however near", () => {
    const c = control();
    const near = (text: string) => facts({ disabled: [c], texts: [{ text, box: at(0, 138, 300, 18) }] });
    expect(rules(near("Round one"))).toEqual(["disabled-without-reason"]);
    expect(rules(near("Entry terms and capacity"))).toEqual(["disabled-without-reason"]);
    expect(rules(near("Locked."))).toEqual(["disabled-without-reason"]);
    expect(rules(near("1 . 2 . 3 . 4"))).toEqual(["disabled-without-reason"]);
    expect(rules(near("Locked because the tournament is live."))).toEqual([]);
    expect(isReason("Only an organizer can change the entry terms.")).toBe(true);
    expect(isReason("Why is this greyed out?")).toBe(true);
    expect(isReason("Save entry terms")).toBe(false);
  });

  it("rule 2: a save button with nothing to save is its own reason; nothing else that starts with the letters is", () => {
    for (const label of ["Saved", "Saving…", "Save changes", "Save entry terms", "Save"]) {
      expect(isSaveState({ tag: "button", label }), label).toBe(true);
      expect(rules(facts({ disabled: [control({ label })] })), label).toEqual([]);
    }
    for (const label of ["Delete round", "Saver", "Unsaved changes", "Launch tournament"]) {
      expect(isSaveState({ tag: "button", label }), label).toBe(false);
      expect(rules(facts({ disabled: [control({ label })] })), label).toEqual(["disabled-without-reason"]);
    }
    // A box labelled "Saved" is a box, not a save button.
    expect(rules(facts({ disabled: [control({ tag: "input", sig: "input[type=text].input", label: "Saved" })] }))).toEqual(["disabled-without-reason"]);
  });

  it("rule 2: a pager at one end of its run is its own reason; a pager dead at both ends, or anything that is not a pager, is not", () => {
    const prev = (over: Partial<DisabledControl> = {}) => control({ label: "Previous", pairedWith: { label: "Next", disabled: false }, ...over });
    const next = (over: Partial<DisabledControl> = {}) => control({ label: "Next", pairedWith: { label: "Previous", disabled: false }, ...over });
    // The first hole, and the last.
    expect(isPagerEnd(prev())).toBe(true);
    expect(isPagerEnd(next())).toBe(true);
    expect(rules(facts({ disabled: [prev()] }))).toEqual([]);
    expect(rules(facts({ disabled: [next()] }))).toEqual([]);
    // CONTROL: both ends dead is a lock or a single page, and must say why.
    const dead = [prev({ pairedWith: { label: "Next", disabled: true } }), next({ pairedWith: { label: "Previous", disabled: true } })];
    expect(dead.map(isPagerEnd)).toEqual([false, false]);
    expect(judge(facts({ disabled: dead }), { width: SWEEP_WIDTH }).map((v) => v.sig)).toEqual(['button.btn.btn-secondary "Previous"', 'button.btn.btn-secondary "Next"']);
    // CONTROL: a greyed Next with no counterpart in a named group of two (the collector gives no pair) is a form waiting for an answer.
    expect(rules(facts({ disabled: [control({ label: "Next" })] }))).toEqual(["disabled-without-reason"]);
    // The pair is Previous with Next, by those words exactly; nothing else beside a live button is exempt.
    for (const c of [
      next({ pairedWith: { label: "Back", disabled: false } }),
      next({ pairedWith: { label: "Next", disabled: false } }),
      control({ label: "Continue", pairedWith: { label: "Previous", disabled: false } }),
      control({ label: "Next round", pairedWith: { label: "Previous", disabled: false } }),
      control({ label: "Delete round", pairedWith: { label: "Next", disabled: false } }),
      next({ tag: "input", sig: "input[type=text].input" }),
    ]) {
      expect(isPagerEnd(c), c.label).toBe(false);
      expect(rules(facts({ disabled: [c] })), c.label).toEqual(["disabled-without-reason"]);
    }
  });

  it("rule 2: forty greyed boxes of one kind are one line, and two kinds are two", () => {
    const many = Array.from({ length: 40 }, (_, i) => control({ sig: "input[type=text].input", tag: "input", label: `Handicap for Wren Halloway`, box: at(0, i * 50) }));
    const other = control({ sig: "select.input", tag: "select", label: "Tee for Ostin Pell" });
    const found = judge(facts({ disabled: [...many, other] }), { width: SWEEP_WIDTH, names: ["Wren Halloway", "Ostin Pell"] });
    expect(found.map((v) => v.sig)).toEqual(['input[type=text].input "Handicap for <name>"', 'select.input "Tee for <name>"']);
  });

  it("rule 3: two primaries in one row or card is a finding; one to each is not", () => {
    const p = (label: string, container: number, containerSig = "div.card") => ({ label, container, containerSig });
    const two = judge(facts({ primaries: [p("Save event", 0), p("Launch tournament", 0)] }), { width: SWEEP_WIDTH });
    expect(two.map((v) => v.rule)).toEqual(["two-primaries"]);
    expect(two[0].sig).toBe("div.card [Launch tournament | Save event]");
    expect(rules(facts({ primaries: [p("Save event", 0), p("Launch tournament", 1)] }))).toEqual([]);
    expect(rules(facts({ primaries: [p("Approve", 0, "tr"), p("Approve", 1, "tr"), p("Approve", 2, "tr")] }))).toEqual([]);
    expect(rules(facts({ primaries: [p("One", 0), p("Two", 0), p("Three", 0), p("Four", 1)] }))).toEqual(["two-primaries"]);
  });

  it("all three at once are three findings", () => {
    const all = facts({
      scrollWidth: 400,
      disabled: [control()],
      primaries: [{ label: "One", container: 0, containerSig: "div.card" }, { label: "Two", container: 0, containerSig: "div.card" }],
    });
    expect(rules(all).sort()).toEqual([...RULES].sort());
  });

  it("the gap between two boxes is 0 when they touch and the straight line when they do not", () => {
    expect(gap(at(0, 0, 10, 10), at(5, 5, 10, 10))).toBe(0);
    expect(gap(at(0, 0, 10, 10), at(10, 0, 10, 10))).toBe(0);
    expect(gap(at(0, 0, 10, 10), at(0, 30, 10, 10))).toBe(20);
    expect(gap(at(0, 0, 10, 10), at(13, 14, 10, 10))).toBe(5);
    expect(gap(at(13, 14, 10, 10), at(0, 0, 10, 10))).toBe(5);
  });

  it("a signature carries no name, id, figure or day of the run that made it", () => {
    const names = ["Wren Halloway", "zz-status-sweep-smallphone"];
    expect(scrub('button.btn "Withdraw Wren Halloway"', names)).toBe('button.btn "Withdraw <name>"');
    expect(scrub("Tee for Wren", names)).toBe("Tee for <name>");
    expect(scrub("zz-status-sweep-smallphone event", names)).toBe("<name> event");
    expect(scrub("round-cmh2k3j4l0000abcd1234efgh")).toBe("round-<id>");
    expect(scrub("Round 2 of 14")).toBe("Round # of #");
    expect(scrub("Close Sat, 21 Nov 2026")).toBe("Close <date>");
    expect(scrub("Close Saturday, November 21, 2026")).toBe("Close <date>");
    expect(scrub("Close Nov 21")).toBe(scrub("Close Dec 3"));
    // A word that only begins like a name, or like a month with no day beside it, is left alone.
    expect(scrub("Wrench set", names)).toBe("Wrench set");
    expect(scrub("You may change it")).toBe("You may change it");
  });

  it("the ratchet: what is new, and what is gone, each by name", () => {
    const a = keyOf("live", "/stages", { rule: "disabled-without-reason", sig: 'select.input "Format for Round #"' });
    const b = keyOf("setting-up", "/event", { rule: "two-primaries", sig: "div.card [Save dates | Save event]" });
    expect(a).toBe('live /stages :: disabled-without-reason :: select.input "Format for Round #"');
    expect(ratchet([a, b], [a, b])).toEqual({ added: [], gone: [] });
    expect(ratchet([a, b], [a])).toEqual({ added: [b], gone: [] });
    expect(ratchet([a], [a, b])).toEqual({ added: [], gone: [b] });
    expect(ratchet([a, a], [])).toEqual({ added: [a], gone: [] });
    expect(JSON.parse(knownFile([b, a, b]))).toEqual([a, b].sort());
    expect(KEY_SHAPE.test(a)).toBe(true);
    expect(KEY_SHAPE.test(keyOf("live", "/organization#plan", { rule: "sideways-scroll", sig: "page" }))).toBe(true);
    expect(KEY_SHAPE.test("live /stages :: no-such-rule :: page")).toBe(false);
    expect(KEY_SHAPE.test("/stages :: sideways-scroll :: page")).toBe(false);
  });

  it("each walk is held to its own lines of the one known list: the assistant's carry their stage's prefix", () => {
    const org = keyOf(stageFor("organizer", "live"), "/stages", { rule: "disabled-without-reason", sig: 'select.input "Format for Round #"' });
    const asst = keyOf(stageFor("assistant", "live"), "/grouping", { rule: "disabled-without-reason", sig: 'select.input "Tees for <name>"' });
    expect(asst).toBe('assistant-live /grouping :: disabled-without-reason :: select.input "Tees for <name>"');
    expect(org.startsWith(ASSISTANT_STAGE_PREFIX)).toBe(false);
    // A line of either walk is a line of the list.
    expect(KEY_SHAPE.test(org)).toBe(true);
    expect(KEY_SHAPE.test(asst)).toBe(true);
    expect(KEY_SHAPE.test(keyOf(stageFor("assistant", "setting-up"), "/registration#entry", { rule: "sideways-scroll", sig: "page" }))).toBe(true);
    const both = [org, asst];
    expect(knownFor(both, "organizer")).toEqual([org]);
    expect(knownFor(both, "assistant")).toEqual([asst]);
    // So neither walk's ratchet calls the other's line "gone", and none is held by both.
    expect(ratchet([org], knownFor(both, "organizer"))).toEqual({ added: [], gone: [] });
    expect(ratchet([asst], knownFor(both, "assistant"))).toEqual({ added: [], gone: [] });
    expect([...knownFor(both, "organizer"), ...knownFor(both, "assistant")].sort()).toEqual([...both].sort());
  });

  it("an assistant's menu is the Organizer's less the screens only an Organizer opens, and still a console", () => {
    const hrefs = (role: "admin" | "assistant") => new Set(navForRole(role, undefined, {}).flatMap((s) => s.items.map((i) => i.href)));
    const organizer = hrefs("admin");
    const assistant = hrefs("assistant");
    for (const h of assistant) expect(organizer.has(h), `${h} is on the assistant's menu and not the Organizer's`).toBe(true);
    const lost = [...organizer].filter((h) => !assistant.has(h)).sort();
    // The role shuts these at the door (SCREEN_ACCESS "admin" only). If this list empties, the second walk has nothing to teach.
    expect(lost).toEqual(["/access", "/event", "/organization", "/tournaments"]);
    // And what remains is a real console: the walk's control asks for more than ten screens.
    expect(assistant.size).toBeGreaterThan(10);
    for (const must of ["/dashboard", "/stages", "/registration", "/grouping", "/prizes"]) expect(assistant.has(must), must).toBe(true);
  });

  it("the known list is a sorted list of whole lines, each once (what the spec prints is what it takes)", () => {
    const raw = readFileSync(join(process.cwd(), "e2e", "console-sweep-known.json"), "utf8");
    const known: unknown = JSON.parse(raw);
    expect(Array.isArray(known)).toBe(true);
    const lines = known as string[];
    for (const line of lines) {
      expect(typeof line, String(line)).toBe("string");
      expect(KEY_SHAPE.test(line), `not a line of the list: ${line}`).toBe(true);
    }
    expect(lines, "the list is sorted and holds each line once: paste the spec's own block").toEqual([...new Set(lines)].sort());
    // The form the spec prints is the form the file is kept in, so a paste changes only the lines that changed.
    expect(raw.split("\r\n").join("\n").trim()).toBe(knownFile(lines));
  });
});
