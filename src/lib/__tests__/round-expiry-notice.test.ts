import { describe, it, expect } from "vitest";
import { expiryNotice, hoursLeft, isExpired, QUICK_ROUND_TTL_HOURS } from "@/lib/domain/round-expiry";
import { readSource } from "./source";

/**
 * The people whose scores are about to go, and what they are told.
 *
 * A casual round deletes itself about a day after it is set up, and the whole
 * justification for that being acceptable is that the people it belongs to are
 * told BEFORE it happens. Two things were wrong with that:
 *
 * The warning rendered only on /dashboard, and `landingScreenFor` sends every
 * player to /me. So in an Ada-versus-Bo round the person who set it up was
 * warned and their opponent was not, and the other three of a fourball lost
 * the card with no notice at all.
 *
 * And the sentence names a button. `keepRound` is staff-only and refuses
 * everybody else by name, so "Keep it to hold on to the scores" was an
 * instruction a player could not follow, about scores they were about to lose.
 */
describe("what a casual round tells the people in it", () => {
  it("names the button for whoever can press it", () => {
    expect(expiryNotice(6, true)).toContain("Keep it to hold on to the scores");
  });

  it("names the remedy a player actually has", () => {
    const s = expiryNotice(6, false);
    expect(s).toContain("Ask whoever set it up");
    // Not the button. `keepRound` refuses them, so this would be an
    // instruction that fails when followed.
    expect(s).not.toContain("Keep it to hold on to");
  });

  it("still warns the player, which is the half that must never be hidden", () => {
    // The button is the part they cannot use; the sentence is the part they
    // need. An empty string here is scheduled data loss nobody consented to.
    expect(expiryNotice(6, false)).toContain("deleted");
    expect(expiryNotice(0, false)).toContain("deleted");
  });

  it("says nothing at all about a tournament, to either of them", () => {
    // `hoursLeft` is null for every tournament that has ever existed, and an
    // empty notice is what stops the banner mounting.
    expect(expiryNotice(null, true)).toBe("");
    expect(expiryNotice(null, false)).toBe("");
  });

  it("keeps the no-countdown rule for both readers", () => {
    /**
     * The sweep runs once a day, so a round that expires at 07:00 is not
     * actually removed until the next pass. "Deleted in about 7 hours" would
     * be a promise the app cannot keep, and the person who believes the
     * precise version is the person who waits.
     */
    for (const canKeep of [true, false]) {
      expect(expiryNotice(7, canKeep)).not.toMatch(/\b7\b/);
      expect(expiryNotice(7, canKeep)).toContain("about a day");
    }
  });

  it("changes its first half, not its second, once the day has gone", () => {
    expect(expiryNotice(0, false)).toContain("passed its day");
    expect(expiryNotice(0, false)).toContain("Ask whoever set it up");
  });
});

/**
 * And the banner has to be ON the screen a player lands on.
 *
 * A pure test of the wording cannot see that — it passed for the whole time
 * the warning was rendering on a screen no player ever reaches.
 */
describe("where the warning renders", () => {
  it("is on the player's own screen, worded for a player", () => {
    const me = readSource("src/app/(player)/me/page.tsx");
    expect(me).toMatch(/<RoundExpiryBanner/);
    expect(me).toMatch(/expiryNotice\(hoursLeft\(state\.event\), false\)/);
    expect(me).toMatch(/canKeep=\{false\}/);
  });

  it("is still on the console, worded for whoever can keep it", () => {
    const dash = readSource("src/app/(app)/dashboard/page.tsx");
    expect(dash).toMatch(/expiryNotice\(hoursLeft\(event\), isStaff\)/);
  });
});

/** The rules underneath it, unchanged — the control on everything above. */
describe("the expiry rule itself", () => {
  it("is a stored column and never inferred", () => {
    expect(isExpired({ expiresAt: null })).toBe(false);
    expect(isExpired({})).toBe(false);
    expect(hoursLeft({ expiresAt: null })).toBeNull();
  });

  it("never promises time that has already gone", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    // Fifty minutes left rounds DOWN to nought, not up to one hour.
    expect(hoursLeft({ expiresAt: new Date("2026-06-01T12:50:00Z") }, now)).toBe(0);
    expect(hoursLeft({ expiresAt: new Date("2026-06-01T11:00:00Z") }, now)).toBe(0);
    expect(hoursLeft({ expiresAt: new Date("2026-06-02T12:00:00Z") }, now)).toBe(QUICK_ROUND_TTL_HOURS);
  });
});

/**
 * AND THE PLAY SHELL, which became the important one last.
 *
 * A casual round deletes itself about a day after it is set up, and the whole
 * justification is that the people it belongs to are told first. The warning
 * reached /dashboard, then /me — and `/play` was still silent.
 *
 * That was defensible while a guest could not reach a card at all. It stopped
 * being defensible the moment a quick round started issuing a Round Code: a
 * fourball's other three players now score here, with no account, and they
 * were scoring a round that vanished overnight with nothing said.
 */
describe("the play shell tells a code-redeemed player too", () => {
  const play = () => readSource("src/components/PlayClient.tsx");

  it("renders the warning in the shell, not in each surface", () => {
    /**
     * In `Shell`, so a surface added later carries it without anybody
     * remembering — and there are four of them already (the picker, the match,
     * the no-match note and the card). Adding it four times is how three of
     * them end up right and one does not.
     */
    const src = play();
    const shell = src.slice(src.indexOf("function Shell("), src.indexOf("export function PlayClient"));
    expect(shell).toMatch(/\{notice && \(/);
    // And every surface passes it.
    expect(src.split("<Shell brand={props.brand} notice={props.expiryNotice}>").length - 1).toBeGreaterThanOrEqual(4);
    expect(src).not.toMatch(/<Shell brand=\{props\.brand\}>/);
  });

  it("is worded for somebody who cannot keep the round", () => {
    // `keepRound` is staff-only and the people on this surface are exactly the
    // ones who are not staff.
    const page = readSource("src", "app", "play", "page.tsx");
    expect(page).toMatch(/expiryNotice\(hoursLeft\(event\), false\)/);
    /**
     * EVERY surface, counted — not "it appears somewhere".
     *
     * There are three `PlayClient` renders with an event behind them: the
     * card, the no-match note and the match itself. Asserting the prop is
     * merely present left unwiring one of the three green, which mutation
     * caught: two right and one silently not is exactly the shape this file
     * keeps finding.
     */
    expect(page.split("expiryNotice={expiry}").length - 1).toBe(3);
  });

  it("says nothing on the screen that has no round yet", () => {
    // The two `stage="code"` returns come before the event is even loaded —
    // there is nothing to be temporary until a code has been redeemed.
    const page = readSource("src", "app", "play", "page.tsx");
    expect(page).toMatch(/if \(!session\) return <PlayClient stage="code" \/>;/);
    expect(page).toMatch(/if \(!event\) return <PlayClient stage="code" \/>;/);
  });
});

/**
 * And the code screen speaks to both kinds of round.
 *
 * It cannot know which it is: the code has not been entered, so there is no
 * event to ask about its shape. The wording therefore has to be true of a club
 * medal and a Sunday fourball at once.
 */
describe("what the code screen says it is asking for", () => {
  it("does not send a casual golfer looking for a tee sheet", () => {
    /**
     * It read "the round code your organizer gave you — it's on the tee
     * sheet". A quick round has neither, and since one started issuing codes
     * this is the screen its players arrive on.
     */
    const src = readSource("src/components/PlayClient.tsx");
    const screen = src.slice(src.indexOf("Type the round code"), src.indexOf("Type the round code") + 240);
    expect(screen).not.toMatch(/your organizer gave you/);
    expect(screen).toMatch(/whoever set the round up/i);
  });

  it("still tells a tournament player where to look", () => {
    // The tee sheet is kept as an example rather than dropped — a club medal's
    // players really do read it off one.
    const src = readSource("src/components/PlayClient.tsx");
    const screen = src.slice(src.indexOf("Type the round code"), src.indexOf("Type the round code") + 240);
    expect(screen).toMatch(/tee sheet/);
  });
});

/**
 * And the SHOTS have to reach that card from the server.
 *
 * A render test hands them in, so it cannot see the page failing to send them
 * — the wiring failure that has caught this suite three times today. The
 * defect it would hide is the one `stroke.ts` names: points computed from a
 * raw index while the dots beside them come from the resolved figure, "three
 * to five strokes apart on the same screen".
 */
describe("what the play page sends the card", () => {
  const page = () => readSource("src", "app", "play", "page.tsx");

  it("resolves the playing handicap through the one resolver", () => {
    // `strokeHandicapFor` puts a committee override and the frozen value ahead
    // of the roster figure, and applies the round's allowance. Rebuilding it
    // from `player.handicap` is the documented fault.
    expect(page()).toMatch(/strokeHandicapFor\(session\.playerId, cardStage\.id\)/);
    expect(page()).toMatch(/holeStrokesReceived\(playing, roundCard\.strokeIndex\[h\] \?\? 18, holeCount\)/);
  });

  it("tells the card how the round is scored, and what it is", () => {
    const src = page();
    expect(src).toMatch(/scoringBasis=\{cardStage\.scoringBasis\}/);
    // The format too: Modified Stableford is won on points whatever the basis
    // says, and only the format knows that.
    expect(src).toMatch(/roundFormat=\{cardStage\.format\}/);
    expect(src).toMatch(/shots=\{shots\}/);
  });

  it("selects the format it passes, rather than sending undefined", () => {
    // The select is the easy half to forget: the prop would still be there and
    // every Modified Stableford round would quietly score on the standard
    // table.
    const src = page();
    const select = src.slice(src.indexOf("const cardStage"), src.indexOf("const cardStage") + 400);
    expect(select).toMatch(/format: true/);
    expect(select).toMatch(/scoringBasis: true/);
  });
});

/**
 * And the page has to tell the card which kind of round it is.
 *
 * The render tests hand `staffApproves` in, so they cannot see the page
 * failing to send it — in which case it is undefined, falsy, and every
 * charity day quietly stops mentioning the committee that really is going to
 * review the card. The wrong direction of the same bug.
 */
describe("who the play page says accepts a card", () => {
  it("reads the round's own approval setting", () => {
    const page = readSource("src", "app", "play", "page.tsx");
    expect(page).toMatch(/staffApproves=\{!allowsAutoConfirm\(settings\)\}/);
  });
});
