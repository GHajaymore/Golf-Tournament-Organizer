import { NextResponse } from "next/server";
import { formatAccessCode } from "@/lib/code-format";
import { DEMO_DOORS, type DemoDoor } from "@/lib/domain/demo-club";
import { demoLinks, demoMark, demoRoundCode, demoStatus } from "@/lib/services/demo-club";

/**
 * `/demo/board`, `/demo/event`, `/demo/clubhouse`, `/demo/finished`,
 * `/demo/report` and `/demo/card` — the demo club's pages by a name that never
 * changes (2026-10-24; docs/claude/demo-club.md). The landing's buttons and its
 * QR point here, so they need no database and still go somewhere true whether
 * or not the demo has been built: to the page, or to `/demo`, which says it is
 * on its way.
 *
 * `card` opens a player's card the way a round's printed sign does
 * (`/play#CODE`). The demo's cards are kept by its committee, so a visitor sees
 * one fill in and cannot write into it.
 *
 * Never indexed: the answer is a redirect, and it says so to a crawler too.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: Request, { params }: { params: Promise<{ door: string }> }) {
  const { door } = await params;
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), { status: 307, headers: HEADERS });
  if (!(DEMO_DOORS as readonly string[]).includes(door)) return to("/demo");
  const mark = demoMark();
  const status = await demoStatus(mark).catch(() => null);
  if (!status?.built) return to("/demo");
  const links = demoLinks(mark);
  const where: Record<Exclude<DemoDoor, "card">, string> = {
    board: links.board,
    event: links.event,
    clubhouse: links.clubhouse,
    finished: links.finishedEvent,
    report: links.report,
  };
  if (door === "card") {
    const code = await demoRoundCode(mark);
    return to(code ? `/play#${formatAccessCode(code)}` : "/demo");
  }
  return to(where[door as Exclude<DemoDoor, "card">]);
}
