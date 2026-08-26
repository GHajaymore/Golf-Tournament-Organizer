import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The public board is cached. These are the three things that make that safe.
 *
 * A cache is two promises: that the crowd shares one computation, and that the
 * computation is retired when it stops being true. The first is measurable —
 * `scripts/load-board.mjs` put it at 20.7 queries per request before and 2.5
 * after. The second is a contract between code that writes and code that
 * reads, and a contract with two authors drifts silently: the board simply
 * stops updating, and nothing fails anywhere.
 */

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string) => revalidateTag(tag),
  unstable_cache: (fn: () => unknown) => fn,
  revalidatePath: () => {},
}));

const { boardChanged } = await import("@/lib/services/board-refresh");
const { boardTag } = await import("@/lib/services/live-board");

const SERVICES = join(process.cwd(), "src", "lib", "services");
const LIVE_PAGE = join(process.cwd(), "src", "app", "live", "[token]", "page.tsx");

beforeEach(() => revalidateTag.mockClear());

describe("the writer and the reader agree on the tag", () => {
  it("retires exactly the board that moved", () => {
    boardChanged("evt_123");
    expect(revalidateTag).toHaveBeenCalledWith("board:evt_123");
  });

  it("names one event, so one club's score cannot clear another's board", () => {
    // The cache key and the tag both carry the event id. If either dropped it,
    // two tournaments on a Saturday morning would share one entry — the exact
    // shape of the skins-pot bug the 2026-08-25 audit found four times.
    expect(boardTag("a")).not.toBe(boardTag("b"));
    expect(boardTag("evt_123")).toContain("evt_123");
  });

  it("does nothing rather than something wrong when given no event", () => {
    boardChanged("");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("composes the tag in ONE place", () => {
    // `board:` spelled out at a call site is a contract with a second author.
    // Everything must go through boardTag().
    const refresh = readFileSync(join(SERVICES, "board-refresh.ts"), "utf8");
    expect(refresh).toMatch(/boardTag\(/);
    expect(refresh.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/["'`]board:/);
  });
});

describe("what the cache must never swallow", () => {
  const board = readFileSync(join(SERVICES, "live-board.ts"), "utf8");
  const page = readFileSync(LIVE_PAGE, "utf8");

  it("keeps the timestamp OUT of the cached payload", () => {
    /**
     * THE TRAP THIS EXISTS FOR, and it has no visible symptom.
     *
     * `renderedAt` is what the freshness label measures age from. Cached
     * alongside the board, it would report the CACHE's age rather than the
     * RESPONSE's — so a board served from a minute-old entry would announce
     * itself as "updated just now". That is precisely the lie the label was
     * built to prevent, and nothing would look wrong.
     */
    expect(board).not.toMatch(/renderedAt/);
    expect(page).toMatch(/renderedAt=\{new Date\(\)\.toISOString\(\)\}/);
  });

  it("checks the share token on every request, never from cache", () => {
    // The token is a CREDENTIAL and the published flag is a PERMISSION. A club
    // that unpublishes its board is not asking to be unpublished within a
    // minute. The lookup stays in the page, outside `liveBoard`.
    expect(page).toMatch(/findUnique\(\{\s*where:\s*\{\s*shareToken/);
    expect(page).toMatch(/isLeaderboardPublic/);
    expect(board).not.toMatch(/shareToken/);
    expect(board).not.toMatch(/isLeaderboardPublic/);
  });

  it("keeps a time-based backstop, so a forgotten tag is a nuisance not a bug", () => {
    // Twelve action files write something the board shows and only the score
    // paths fire the tag today. The backstop is what makes that survivable:
    // worst case the board is a minute behind, rather than wrong until deploy.
    expect(board).toMatch(/revalidate:\s*\d+/);
  });
});
