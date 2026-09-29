import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { alarmOnChange, cleanSuspendNote, playStatusOf, resumedWords, suspendedWords, MAX_SUSPEND_NOTE } from "../play-status";
import { PlaySuspendedBanner } from "@/components/PlaySuspendedBanner";

/**
 * PLAY SUSPENDED (Rule 5.7, 2026-09-28): one set of words for the banner, the
 * push and the public board.
 */
describe("what a player is told", () => {
  it("says stop now, with the organizer's reason first", () => {
    const w = suspendedWords("Lightning in the area.", "organiser");
    expect(w.title).toBe("Play is suspended");
    expect(w.body).toBe("Lightning in the area. Stop now and don't play another shot until the organiser resumes play.");
  });

  it("still says stop with no reason given", () => {
    expect(suspendedWords("").body).toBe("Stop now and don't play another shot until the organizer resumes play.");
  });

  it("sends them back to where they stopped on resume (Rule 5.7d)", () => {
    expect(resumedWords().body).toMatch(/where you stopped/);
  });

  it("bounds the reason", () => {
    expect(cleanSuspendNote("  lightning \n  nearby ")).toBe("lightning nearby");
    expect(cleanSuspendNote("x".repeat(500))).toHaveLength(MAX_SUSPEND_NOTE);
    expect(cleanSuspendNote(42)).toBe("");
  });
});

describe("the alarm on an open screen", () => {
  it("sounds only when it sees play go from on to suspended", () => {
    expect(alarmOnChange(false, true)).toBe("siren");
  });
  it("refreshes quietly when play resumes", () => {
    expect(alarmOnChange(true, false)).toBe("refresh");
  });
  it("CONTROL: stays quiet with no change — including a screen opened mid-suspension", () => {
    expect(alarmOnChange(true, true)).toBeNull();
    expect(alarmOnChange(false, false)).toBeNull();
  });
});

describe("the banner", () => {
  it("is an alert naming the reason while play is suspended", () => {
    const html = renderToStaticMarkup(
      <PlaySuspendedBanner status={playStatusOf({ playSuspendedAt: new Date(), playSuspendedNote: "Lightning" })} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Play is suspended");
    expect(html).toContain("Lightning. Stop now");
  });

  it("CONTROL: renders nothing while play is on", () => {
    const html = renderToStaticMarkup(
      <PlaySuspendedBanner status={playStatusOf({ playSuspendedAt: null, playSuspendedNote: "" })} />,
    );
    expect(html).toBe("");
  });
});
