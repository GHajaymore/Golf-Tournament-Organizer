import { NextResponse } from "next/server";
import { importCatalogueSlice, refreshCatalogueSlice } from "@/lib/services/catalogue-import";
import { importGcaSlice, gcaFetch } from "@/lib/services/catalogue-gca";

/**
 * The production course catalogue's day — see `services/catalogue-import.ts`
 * and `services/catalogue-gca.ts`.
 *
 * Ajay, 2026-10-04: "get whatever the limit is everyday without my
 * involvement. domestic or international", and "make sure the clean and
 * complete and latest golf course score card gets into production". So each
 * run does three things, in this order:
 *
 *  1. INTERNATIONAL — GolfCourseAPI, the only source of a complete card
 *     outside the US, when GOLFCOURSE_API_KEY is set. Its free allowance is
 *     the scarce one (50 a day for the key), so it goes first and on its own
 *     clock.
 *  2. LATEST — re-fetch the stored courses read longest ago; a better card
 *     replaces the old one and a card today's rules refuse is cleared.
 *  3. DOMESTIC — the OpenGolfAPI walk, US states first, with what is left.
 *
 * Twice a day (`vercel.json`), because one function run cannot spend the
 * free allowance in the time it is given. Per day that is about 440 of
 * OpenGolfAPI's 500 detail requests, leaving the rest for "add this course"
 * in the pickers, and 44 of GolfCourseAPI's 50.
 *
 * Each step is its own try: a fault in one must not cost the other two their
 * day. AUTHORIZATION IS A HARD REFUSAL, exactly as on `expire-rounds`: with
 * `CRON_SECRET` missing this returns 401 rather than letting anyone on the
 * internet spend the app's allowances and write to its catalogue.
 */

export const dynamic = "force-dynamic";
/** The platform's ceiling. Every step stops itself well inside it. */
export const maxDuration = 300;

const WALK_BUDGET = 200;
const REFRESH_BUDGET = 20;
const GCA_BUDGET = 22;
/** Stop starting requests after four and a half minutes. */
const RUN_FOR_MS = 270_000;
/** The international slice's own clock: at 1.5s a request, 22 fit in it. */
const GCA_FOR_MS = 75_000;

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

  const started = Date.now();
  const deadline = started + RUN_FOR_MS;
  const key = (process.env.GOLFCOURSE_API_KEY ?? "").trim();

  const international = key
    ? await step(() =>
        importGcaSlice({ budget: GCA_BUDGET, deadline: Math.min(deadline, started + GCA_FOR_MS), fetchJson: gcaFetch(key) }),
      )
    : { skipped: "GOLFCOURSE_API_KEY is not set" };
  const latest = await step(() => refreshCatalogueSlice({ budget: REFRESH_BUDGET, deadline }));
  const domestic = await step(() => importCatalogueSlice({ budget: WALK_BUDGET, deadline }));

  // Counts and positions: public course data, nothing about a person.
  return NextResponse.json({ ok: true, international, latest, domestic });
}
