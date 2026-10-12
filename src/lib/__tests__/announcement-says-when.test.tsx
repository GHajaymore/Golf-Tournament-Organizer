import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnouncementList } from "@/components/AnnouncementList";
import { AnnouncementCard } from "@/components/AnnouncementCard";
import { readSource } from "./source";

/**
 * A NOTICE SAYS WHEN IT WAS POSTED, on the player's screen as on the organizer's.
 *
 * Walked 2026-09-28: the secretary's Announcements screen read "Tee times moved
 * ten minutes later · just now", and the member's Today showed the same notice
 * with no time at all — so a notice about THIS morning's tee times could not be
 * told from last week's by the one person it was written for.
 */
const text = (html: string) => html.replace(/<!--[^>]*-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("a posted notice carries its age", () => {
  it("says how long ago it was posted, in the app's own words", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const body = text(
      renderToStaticMarkup(
        <AnnouncementList items={[{ id: "a", title: "Tee times moved", body: "", pinned: false, createdAt: twoHoursAgo }]} />,
      ),
    );
    expect(body).toContain("Tee times moved");
    expect(body).toContain("· 2 hours ago");
  });

  it("the control: a notice with no time says none rather than inventing one", () => {
    const body = text(
      renderToStaticMarkup(<AnnouncementList items={[{ id: "a", title: "Tee times moved", body: "", pinned: true }]} />),
    );
    expect(body).toContain("Pinned");
    expect(body).not.toContain("·");
  });

  /**
   * AND THE CARD DOES NOT WORK IT OUT FOR ITSELF (2026-10-11).
   *
   * On the player's Today the card is drawn twice — by the server, then by the
   * phone taking the page over — and it read the clock both times. A notice
   * caught on a boundary said "just now" and then "2 minutes ago": a hydration
   * mismatch on the screen where that fault had last struck. The list words it
   * once and hands the words down.
   */
  it("the card prints the words it is handed, and nothing of its own from the date", () => {
    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const handed = text(
      renderToStaticMarkup(
        <AnnouncementCard a={{ id: "a", title: "Tee times moved", body: "", pinned: false, createdAt: longAgo, since: "a made-up while ago" }} />,
      ),
    );
    expect(handed).toContain("· a made-up while ago");
    expect(handed).not.toContain("3 days ago");
    // CONTROL: a date and no words is no time at all — the card has no clock.
    const bare = text(
      renderToStaticMarkup(<AnnouncementCard a={{ id: "a", title: "Tee times moved", body: "", pinned: false, createdAt: longAgo }} />),
    );
    expect(bare).toContain("Tee times moved");
    expect(bare).not.toContain("ago");
  });

  it("the folded list on Today carries the same words down to the card", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const item = { id: "a", title: "Tee times moved", body: "", pinned: false, createdAt: twoHoursAgo };
    for (const props of [{ foldSeen: true }, { lineOnceRead: true }]) {
      expect(text(renderToStaticMarkup(<AnnouncementList items={[item]} {...props} />))).toContain("· 2 hours ago");
    }
  });

  it("the organizer's screen uses the same words, not a private '4h ago'", () => {
    const src = readSource("src/app/(app)/announcements/page.tsx");
    expect(src).toMatch(/when: sinceWords\(a\.createdAt\)/);
    expect(src).not.toMatch(/h ago/);
  });
});
