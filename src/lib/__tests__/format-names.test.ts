import { describe, it, expect } from "vitest";
import { TOURNAMENT_TEMPLATES } from "../tournament-templates";
import { GOLF_FORMATS } from "../formats";

/**
 * THE LIST IS IN THE RULES OF GOLF'S WORDS, NOT THE APP'S.
 *
 * Asked for on 2026-09-11: *"organizer can name anything but we need to
 * standardize the list according to the PGA namings."* The two halves are
 * separate and both matter. A tournament's NAME is the organizer's — "Spring
 * Meeting", "The Captain's Day" — and nothing here touches it. What has to be
 * standard is the FORM OF PLAY, because that is a term of art: a list that
 * calls four-ball match play "Pairs match play" tells a club secretary the app
 * does not know golf, and leaves them guessing which pairs format was meant.
 *
 * So the names are the USGA/R&A ones, which are what the PGA uses: Stroke Play
 * and Match Play (Rules 3.2, 3.3), Four-Ball (Rule 23), Foursomes (Rule 22),
 * Stableford (Rule 21.1). Scramble and Skins are not in the Rules and have no
 * competing formal name.
 *
 * "Medal — stroke play" was the one that had to go and is the clearest case:
 * *medal play* is the British colloquial FOR stroke play, so one entry carried
 * two names for one thing — this codebase's oldest defect in miniature, on the
 * first row of the first list a new organizer reads.
 */

describe("every starting point is named for the golf it starts", () => {
  it("leads with the format's own name", () => {
    /**
     * DERIVED, not a second list checked against the first. A template's name
     * has to begin with the name of the format its first round plays, so the
     * two cannot drift: rename the format and this fails until the template
     * agrees, which is the direction that matters — `formats.ts` is where the
     * app's golf vocabulary actually lives.
     *
     * Anything after an em-dash is the qualifier that says WHICH variant —
     * "— round robin", "— alternate shot" — and is free text by design,
     * because the Rules do not name a round robin.
     *
     * THE SCORING BASIS COUNTS TOO, and Stableford is why. Under Rule 21.1 it
     * is a form of play in its own right, and "Stableford" is what a club
     * calls that competition — but this app models it as a stroke-play round
     * with `scoringBasis: "stableford"`, and `Stableford` is deliberately NOT
     * playable as a format (see `template-shapes.test.ts`). So the golf the
     * name has to match is the format OR the basis: matching only the format
     * would force the entry to be called "Stroke Play", which is the right
     * word for the wrong competition.
     */
    for (const t of TOURNAMENT_TEMPLATES) {
      if (t.blank) continue;
      const round = t.rounds[0];
      expect(round, `${t.key} starts no round`).toBeTruthy();
      const golf = [round.format, round.scoringBasis].filter(Boolean).map((w) => String(w).toLowerCase());
      const head = t.name.split("—")[0].trim().toLowerCase();
      expect(
        golf.some((g) => head.includes(g)),
        `${t.key} is called "${t.name}" but plays ${round.format} (${round.scoringBasis ?? "gross"})`,
      ).toBe(true);
    }
  });

  it("names no format the app cannot play", () => {
    // A standard name for a form of play the engine does not implement is a
    // promise that breaks on the first tee.
    const playable = new Set(GOLF_FORMATS.filter((f) => f.playable).map((f) => f.name));
    for (const t of TOURNAMENT_TEMPLATES) {
      for (const r of t.rounds) expect(playable, `${t.key}`).toContain(r.format);
    }
  });

  it("never uses a colloquial where the Rules have a term", () => {
    /**
     * ABSENCE, which is the comment-proof direction — and each of these is a
     * real word somebody might reach for rather than an invented straw man.
     *
     * "medal" is British for stroke play. "best ball" is widely used for
     * four-ball and means something different in the Rules — one player
     * against a side. "bounce game" and "captain's day" are occasions, not
     * formats.
     */
    const colloquial = [/\bmedal\b/i, /\bbest ball\b/i, /\bbounce\b/i, /captain/i, /\bstroke-play\b/i];
    for (const t of TOURNAMENT_TEMPLATES) {
      for (const c of colloquial) {
        expect(t.name, `${t.key} is named "${t.name}"`).not.toMatch(c);
      }
    }
  });

  it("still names no audience", () => {
    /**
     * The rule this list was fixed to obey a day earlier, kept because the PGA
     * rename touched every one of these names and could have quietly undone
     * it. A society picking the template with its own name on it got a
     * match-play round robin.
     */
    for (const t of TOURNAMENT_TEMPLATES) {
      for (const a of [/society/i, /charity/i, /company/i, /member-guest/i, /club championship/i]) {
        expect(t.name, `${t.key} is named for an audience`).not.toMatch(a);
      }
    }
  });

  it("distinguishes the two pairs formats by name", () => {
    /**
     * THE PRECISION THE RENAME BOUGHT. "Pairs match play" and "Foursomes —
     * pairs, one ball" and "Four-ball better ball — pairs" were three entries
     * all leading with or ending in "pairs", and the first did not say which
     * pairs format it meant. It is four-ball.
     */
    const byKey = new Map(TOURNAMENT_TEMPLATES.map((t) => [t.key, t.name]));
    expect(byKey.get("member-guest")).toBe("Four-Ball Match Play");
    expect(byKey.get("four-ball")).toBe("Four-Ball");
    expect(byKey.get("foursomes")).toMatch(/^Foursomes/);
    // Foursomes and four-ball are opposite formats — one ball between two
    // against a ball each — and a reader must not be able to confuse them.
    expect(byKey.get("foursomes")).not.toMatch(/four-ball/i);
  });
});
