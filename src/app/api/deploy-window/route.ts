import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { currentDeployWindow } from "@/lib/services/deploy-window";

/**
 * MAY A DEPLOY GO OUT NOW? — asked by the deploy job, and by nothing else
 * (the testing panel, 2026-10-23; `scripts/qa/deploy-gate.mjs`).
 *
 * The deploy freeze needs every club's time zone and today's tournaments, which
 * live in the production database. The deploy job runs on a GitHub runner,
 * which must never hold production database credentials (CLAUDE.md, "the
 * deploy job does not build"). So the app answers the question itself, from
 * inside, and hands back exactly two things: `frozen` and a one-sentence
 * `reason` made of counts and zone names. No club, tournament or person.
 *
 * AUTHORIZATION IS A HARD REFUSAL, as on the cron routes: `Authorization:
 * Bearer $DEPLOY_WINDOW_TOKEN`, and 401 when it does not match — including when
 * the token is MISSING here, which is the case that matters. The answer is not
 * secret in itself, but "is any club playing right now" is nobody else's
 * business, and an open endpoint that queries the database on demand is a
 * lever for anyone who finds it.
 *
 * A database that cannot be asked is a 503. The deploy job reads anything but a
 * 200 as "not checked" and deploys unfrozen, saying so — a deploy may be the fix.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function allowed(offered: string, secret: string): boolean {
  if (!secret) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!allowed(request.headers.get("authorization") ?? "", process.env.DEPLOY_WINDOW_TOKEN ?? "")) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  try {
    const { frozen, reason } = await currentDeployWindow();
    return NextResponse.json({ frozen, reason }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
