import { NextResponse } from "next/server";
import { sweepExpiredRounds } from "@/lib/services/round-sweep";

/**
 * The scheduled sweep of expired casual rounds.
 *
 * Called by Vercel Cron on the schedule in `vercel.json`. It is a GET because
 * that is what Vercel Cron issues, and it deletes — which is the wrong verb
 * for a GET and unavoidable here, so the authorization below is doing the work
 * a method would otherwise do. Nothing links to this route and nothing but the
 * scheduler should ever reach it.
 *
 * AUTHORIZATION IS A HARD REFUSAL, NOT A FALLBACK. Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when the environment variable is set,
 * and this route returns 401 when the header does not match — including when
 * the secret is MISSING, which is the case that matters. The tempting version
 * is "no secret configured, so let it through", and that publishes an
 * unauthenticated delete-by-clock endpoint on the open internet the first time
 * somebody forgets an environment variable. An unconfigured cron that never
 * runs is a feature that does nothing; an unauthenticated one is a way for
 * anyone to force other people's rounds to be swept.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const offered = request.headers.get("authorization") ?? "";

  if (!secret || offered !== `Bearer ${secret}`) {
    // Deliberately says nothing about which of the two it was. "No secret is
    // configured" is a useful sentence for whoever deploys this and a map for
    // anybody else.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await sweepExpiredRounds();

  /**
   * A count and ids, never names.
   *
   * This response reaches Vercel's logs, and a casual round is named after the
   * people playing it — so returning names would write real players' names
   * into logs they were never meant to be in.
   */
  return NextResponse.json({
    ok: true,
    deleted: result.deleted,
    more: result.more,
  });
}
