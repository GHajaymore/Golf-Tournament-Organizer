import { describe, it, expect } from "vitest";
import { startFromGroups, copyValue, copiedEventId, COPY_PREFIX, MAX_COPYABLE_OFFERED } from "../start-from";
import { TOURNAMENT_TEMPLATES } from "../../tournament-templates";
import { readSource } from "../../__tests__/source";

/**
 * ELEVEN STARTING POINTS RENDERED AS SEVENTEEN OPTIONS.
 *
 * `CreateFirstTournament` listed a "Suits a single round" group and then the
 * whole catalogue again grouped by side size, so seven of its eleven entries
 * appeared TWICE — and it never offered a copy of one of the club's own
 * tournaments, which the dashboard's form had offered all along. Read off the
 * screen on 2026-09-11.
 */

const keysIn = (groups: ReturnType<typeof startFromGroups>) =>
  groups.flatMap((g) => g.options.map((o) => o.value));

describe("what the picker offers", () => {
  it("lists every starting point exactly once", () => {
    /**
     * THE INVARIANT THE WHOLE CHANGE IS FOR, and it is asserted over every
     * shape rather than the one that happened to be broken — the duplication
     * came from a suggested group overlapping a full list, so it reappears for
     * any shape whose suggestions are non-empty.
     */
    for (const shape of ["", "single", "series", "knockout"]) {
      const keys = keysIn(startFromGroups({ shape }));
      expect(new Set(keys).size, `${shape || "(unanswered)"} repeats an option`).toBe(keys.length);
    }
  });

  it("offers all of them, whatever the shape", () => {
    // Suggesting is not filtering: a knockout organizer who wants to start
    // from a medal and add a bracket is doing nothing unusual.
    for (const shape of ["", "single", "series", "knockout"]) {
      const keys = new Set(keysIn(startFromGroups({ shape })));
      for (const t of TOURNAMENT_TEMPLATES) {
        expect(keys.has(t.key), `${shape || "(unanswered)"} is missing ${t.key}`).toBe(true);
      }
    }
  });

  it("puts what suits the answered shape first among the templates", () => {
    const groups = startFromGroups({ shape: "single" });
    const labels = groups.map((g) => g.label);
    expect(labels[0]).toMatch(/^Suits /i);
    expect(labels).toContain("Other starting points");
  });

  it("heads nothing when the shape question has not been answered", () => {
    // A "Suggested" heading over the full list would be a claim the app
    // cannot make yet.
    const labels = startFromGroups({ shape: "" }).map((g) => g.label);
    expect(labels).not.toContain("Suggested");
    expect(labels.some((l) => l.startsWith("Suits"))).toBe(false);
    expect(labels).toContain("Start from a template");
  });

  it("keeps the blank one last and under no heading", () => {
    const groups = startFromGroups({ shape: "single" });
    const last = groups[groups.length - 1];
    expect(last.label, "the blank one was given a heading").toBe("");
    expect(last.options.map((o) => o.value)).toEqual(
      TOURNAMENT_TEMPLATES.filter((t) => t.blank).map((t) => t.key),
    );
  });
});

describe("learning from the club's own tournaments", () => {
  const own = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, name: `Spring Meeting ${2026 - i}` }));

  it("offers them BEFORE every template", () => {
    /**
     * A TOURNAMENT THIS CLUB HAS ALREADY RUN IS THE BEST STARTING POINT THERE
     * IS: it carries the club's own rounds, formats, courses and settings,
     * decided by somebody who knows the golf. No template can. So this is an
     * ordering assertion, not a presence one.
     */
    const groups = startFromGroups({ copyable: own(2), shape: "single" });
    expect(groups[0].label).toBe("Copy one of yours");
    expect(groups[0].options.map((o) => o.label)).toEqual(["Spring Meeting 2026", "Spring Meeting 2025"]);
  });

  it("says nothing about copying when there is nothing to copy", () => {
    // The genuinely-first tournament, which is what this form was built for.
    expect(startFromGroups({ copyable: [], shape: "single" }).map((g) => g.label)).not.toContain(
      "Copy one of yours",
    );
  });

  it("caps the list so the templates stay visible", () => {
    /**
     * A club with nine seasons behind it would otherwise push every template
     * below the fold of a `<select>`, which turns "we also have starting
     * points" into "there are none".
     */
    const groups = startFromGroups({ copyable: own(30), shape: "single" });
    expect(groups[0].options).toHaveLength(MAX_COPYABLE_OFFERED);
    // And it keeps the NEWEST, which is the one somebody is repeating.
    expect(groups[0].options[0].label).toBe("Spring Meeting 2026");
  });

  it("gives an untitled draft something to click", () => {
    // A blank option is one nobody can choose on purpose, and an untitled
    // draft is a real row.
    const groups = startFromGroups({ copyable: [{ id: "e1", name: "   " }] });
    expect(groups[0].options[0].label).toBe("Untitled tournament");
  });
});

describe("leading with the golf this outfit actually plays", () => {
  /**
   * "Make the app more PGA driven but room for customizations like we have
   * now… Club can be more PGA related but Communities/societies can have
   * custom configurations. We can provide the custom options to club as well."
   * Asked 2026-09-11.
   *
   * So: a club leads with the forms the Rules of Golf name, a society leads
   * with the social ones — and BOTH still see every single starting point,
   * which is the half these tests exist to protect. An app that hid a scramble
   * from a club would be wrong about golf rather than opinionated about it.
   */
  const first = (orgKind: string, shape = "") =>
    startFromGroups({ orgKind, shape }).find((g) => g.label !== "")!.options[0].label;

  it("leads a golf club with a form the Rules name", () => {
    expect(first("club")).toBe("Stroke Play");
    expect(first("club", "single")).toBe("Stroke Play");
  });

  it("leads a society with Stableford", () => {
    /**
     * THE EXCEPTION, AND IT IS THE MOST IMPORTANT ROW IN THE LIST. Stableford
     * IS a form of play the Rules name (21.1), so the plain derivation puts it
     * with the club's golf — and it is also what a society plays more than
     * anything else, because a player who blows up a hole picks up and is
     * still in the competition on the next tee.
     *
     * Asserted for both kinds so the exception cannot be "fixed" by dropping
     * Stableford out of the Rules set, which would make a club championship
     * offer it ahead of stroke play.
     */
    expect(first("community")).toBe("Stableford");
    expect(first("community", "single")).toBe("Stableford");
    expect(first("club")).not.toBe("Stableford");
  });

  it("treats a one-off outing with friends as a social occasion", () => {
    // A personal organizer is one person running an outing — the kind's own
    // blurb says so — so they get the society's list, not a championship's.
    expect(first("personal")).toBe("Stableford");
  });

  it("ORDERS and never filters — every outfit still sees everything", () => {
    /**
     * THE ASSERTION THAT KEEPS THIS FROM BECOMING A "SOCIETY EDITION". A club
     * running a scramble for its away day is completely ordinary, and so is a
     * society running a match-play knockout.
     */
    for (const kind of ["club", "community", "personal", "", "nonsense"]) {
      for (const shape of ["", "single", "series", "knockout"]) {
        const keys = new Set(keysIn(startFromGroups({ orgKind: kind, shape })));
        for (const t of TOURNAMENT_TEMPLATES) {
          expect(keys.has(t.key), `${kind || "(none)"}/${shape || "(none)"} hides ${t.key}`).toBe(true);
        }
      }
    }
  });

  it("changes nothing at all when the outfit is not known", () => {
    /**
     * THE CONTROL. Without it every assertion above is satisfied by a sort
     * that fires for everybody, including the brand-new session that has no
     * organization resolved yet — where the app has no business having an
     * opinion about what this person plays.
     */
    /**
     * PINNED TO THE CATALOGUE'S OWN ORDER rather than compared against the
     * no-orgKind call, which was the first version of this and could not fail:
     * both sides went through the same code, so a sort that fired for
     * EVERYBODY changed them both identically and the assertion stayed green.
     * Proven by mutation on 2026-09-11 — `if (!orgKind) return list` deleted,
     * and this test did not notice.
     */
    const catalogueOrder = TOURNAMENT_TEMPLATES.filter((t) => !t.blank).map((t) => t.key);
    const unknown = keysIn(startFromGroups({ orgKind: "", shape: "" })).filter((k) =>
      catalogueOrder.includes(k),
    );
    expect(unknown).toEqual(catalogueOrder);
    // And a known outfit really does reorder it, or the assertion above is
    // satisfied by a sort that never does anything at all.
    expect(keysIn(startFromGroups({ orgKind: "community", shape: "" }))).not.toEqual(
      keysIn(startFromGroups({ orgKind: "", shape: "" })),
    );
  });

  it("keeps the order stable inside each half", () => {
    // Two templates that are alike must not swap places between renders, which
    // is what an unstable comparator would do to a `<select>` under a cursor.
    const once = keysIn(startFromGroups({ orgKind: "club", shape: "single" }));
    expect(keysIn(startFromGroups({ orgKind: "club", shape: "single" }))).toEqual(once);
  });
});

describe("telling an event id from a template key", () => {
  it("round-trips an id", () => {
    expect(copiedEventId(copyValue("abc123"))).toBe("abc123");
  });

  it("returns empty for a template key, so it reads as a plain test", () => {
    /**
     * Empty rather than null, so `if (copiedEventId(v))` is the whole check —
     * and so a caller can never pass the string "null" to `cloneEvent`.
     */
    for (const t of TOURNAMENT_TEMPLATES) expect(copiedEventId(t.key)).toBe("");
  });

  it("uses a prefix no template key could collide with", () => {
    // The two namespaces share one `<select>` value.
    for (const t of TOURNAMENT_TEMPLATES) {
      expect(t.key.startsWith(COPY_PREFIX), `${t.key} collides with the copy prefix`).toBe(false);
    }
  });
});

describe("both create forms read it", () => {
  it("neither builds its own option list any more", () => {
    /**
     * THE POINT OF THE FILE. The two forms had grown different answers to one
     * question — one offered a copy and no suggestions, the other suggestions
     * and no copy — because each assembled its own `<select>`. Asserted as an
     * absence, which is the comment-proof direction.
     */
    for (const file of ["CreateFirstTournament.tsx", "EventSwitcher.tsx"]) {
      const src = readSource("src", "components", file);
      expect(src, `${file} does not use the shared list`).toMatch(/startFromGroups\(\{/);
      expect(src, `${file} still maps the raw template list into options`).not.toMatch(
        /TOURNAMENT_TEMPLATES\.map\(/,
      );
      expect(src, `${file} still builds its own copy prefix`).not.toMatch(/"copy:"/);
    }
  });

  it("both can actually create a copy", () => {
    // `CreateFirstTournament` offered no copy at all before this, so a form
    // that lists one and cannot make it would be worse than the gap.
    for (const file of ["CreateFirstTournament.tsx", "EventSwitcher.tsx"]) {
      const src = readSource("src", "components", file);
      expect(src, `${file} lists copies it cannot create`).toMatch(/cloneEvent\(/);
    }
  });

  it("neither asks how a COPY is played", () => {
    // A copy is played the way its source was, so the question would let the
    // two disagree — and answering it would do nothing, which is worse.
    for (const file of ["CreateFirstTournament.tsx", "EventSwitcher.tsx"]) {
      const src = readSource("src", "components", file);
      expect(src, file).toMatch(/!copyFrom && !shape/);
    }
  });
});
