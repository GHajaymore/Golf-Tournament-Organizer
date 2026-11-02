import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { advanceDemoReplay, demoMark } from "@/lib/services/demo-club";

/**
 * THE DEMO CLUB'S DAY, PLAYED A FEW HOLES AT A TIME (2026-10-24;
 * docs/claude/demo-club.md).
 *
 * Called on a schedule, and by nothing else: every quarter of an hour by
 * `.github/workflows/demo-replay.yml` (bearer `DEMO_REPLAY_TOKEN`), and once a
 * day at the club's early morning by Vercel Cron (`vercel.json`, bearer
 * `CRON_SECRET`, which Vercel sends itself). Each call writes the demo's cards
 * up to the club's present minute through the app's own score writer, and the
 * first call of a new day at the club starts the medal again. A missed call is
 * made up by the next, so the schedule only decides how smoothly the board
 * moves, never what it says.
 *
 * IT ONLY EVER WRITES THE DEMO CLUB: `advanceDemoReplay` finds the club with
 * `isDemo: true` and writes under that club's own tournaments, so the token
 * opens no door to anybody else's rows. The GitHub runner that calls it holds
 * that token and nothing else — never a database credential.
 *
 * AUTHORIZATION IS A HARD REFUSAL, as on the other cron routes: 401 when
 * neither secret matches, including when neither is SET.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function matches(offered: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const offered = request.headers.get("authorization") ?? "";
  if (!matches(offered, process.env.DEMO_REPLAY_TOKEN) && !matches(offered, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  try {
    // Counts and a day, never a name: this reaches the host's logs.
    const result = await advanceDemoReplay({ mark: demoMark() });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
