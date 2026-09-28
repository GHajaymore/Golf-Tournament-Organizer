import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnouncementList } from "@/components/AnnouncementList";
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

  it("the organizer's screen uses the same words, not a private '4h ago'", () => {
    const src = readSource("src/app/(app)/announcements/page.tsx");
    expect(src).toMatch(/when: sinceWords\(a\.createdAt\)/);
    expect(src).not.toMatch(/h ago/);
  });
});
