import { NextResponse } from "next/server";
import { importCatalogueSlice, refreshCatalogueSlice } from "@/lib/services/catalogue-import";

/**
 * The production course catalogue's day — OpenGolfAPI ONLY. See
 * `services/catalogue-import.ts`.
 *
 * Open data (ODbL 1.0, attribution shown beside every result), so walking it is
 * allowed. GolfCourseAPI is NOT: its terms forbid compiling its dataset, and
 * Ajay ruled on 7 Nov 2026 to switch that walk off. It is asked only when an
 * organizer searches (`services/golfcourseapi-live.ts`), and this route must
 * never import it — `golfcourseapi-on-demand.test.ts` fails if it does.
 *
 * Each run, once a day (`vercel.json`):
 *  1. LATEST — re-fetch the stored OpenGolfAPI courses read longest ago; a
 *     better card replaces the old one and a card today's rules refuse is
 *     cleared.
 *  2. DOMESTIC — the walk, US states first, with what is left.
 *
 * Each step is its own try: a fault in one must not cost the other its day.
 * AUTHORIZATION IS A HARD REFUSAL, exactly as on `expire-rounds`: with
 * `CRON_SECRET` missing this returns 401 rather than letting anyone on the
 * internet spend the allowance and write to the catalogue.
 */

export const dynamic = "force-dynamic";
/** The platform's ceiling. Every step stops itself well inside it. */
export const maxDuration = 300;

const WALK_BUDGET = 200;
const REFRESH_BUDGET = 20;
/** Stop starting requests after four and a half minutes. */
const RUN_FOR_MS = 270_000;

async function step<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (e) {
    // The kind of fault, not its text: a message can carry a connection string.
    return { error: e instanceof Error ? e.name : "error" };
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const offered = request.headers.get("authorization") ?? "";
  if (!secret || offered !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const deadline = Date.now() + RUN_FOR_MS;
  const latest = await step(() => refreshCatalogueSlice({ budget: REFRESH_BUDGET, deadline }));
  const domestic = await step(() => importCatalogueSlice({ budget: WALK_BUDGET, deadline }));

  // Counts and positions: public course data, nothing about a person.
  return NextResponse.json({ ok: true, latest, domestic });
}
