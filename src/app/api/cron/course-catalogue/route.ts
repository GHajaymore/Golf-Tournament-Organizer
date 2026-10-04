import { NextResponse } from "next/server";
import { importCatalogueSlice } from "@/lib/services/catalogue-import";

/**
 * The daily slice of the course catalogue — see `services/catalogue-import.ts`.
 *
 * Called by Vercel Cron on the schedule in `vercel.json`, an hour after the
 * round sweep. AUTHORIZATION IS A HARD REFUSAL, exactly as on
 * `expire-rounds` and for the same reason: with `CRON_SECRET` missing this
 * returns 401 rather than letting anyone on the internet spend the app's
 * directory allowance and write to its catalogue.
 */

export const dynamic = "force-dynamic";
/** The platform's ceiling. The slice stops itself well inside it. */
export const maxDuration = 300;

/**
 * 200 of the directory's 500 daily detail requests: the same endpoint serves
 * "add this course" from every course picker, and the people using the app
 * that day come first. At this pace the US (~16,800 courses) is about twelve
 * weeks; the courses people actually search for arrive sooner, because a
 * picked course is copied into the club's own library on the way past.
 */
const DAILY_BUDGET = 200;
/** Stop starting requests after four minutes, leaving a minute for the last. */
const RUN_FOR_MS = 240_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const offered = request.headers.get("authorization") ?? "";
  if (!secret || offered !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await importCatalogueSlice({ budget: DAILY_BUDGET, deadline: Date.now() + RUN_FOR_MS });
  // Counts and a position: public course data, nothing about a person.
  return NextResponse.json({ ok: true, ...result });
}
