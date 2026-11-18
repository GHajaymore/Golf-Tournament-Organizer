import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * IS PLAY SUSPENDED IN MY TOURNAMENT, AND SINCE WHEN — for the console's
 * Suspend play control only (`PlayStatusFrame`; review of #1149, C2 and the
 * re-review's refresh finding).
 *
 * The control lives in the console's layout, which is not drawn again between
 * screens, so an open console has to ask. Asking by re-rendering the whole
 * shell every 20 seconds cost 15–20 queries a time, all day for a season-long
 * league; this is ONE primary-key select, and the frame re-renders only when
 * the answer differs from what it drew.
 *
 * THE DOOR: staff of the session's own tournament, as `suspendPlay` requires
 * (`session.role` admin or assistant); anyone else gets a 401 and no answer.
 * It takes NO argument: the tournament is the session's, never the caller's
 * choice, so nobody can ask about another club's. It answers one timestamp
 * (or "") and nothing else, and it writes nothing. `getSession` carries the
 * sign-in hold and the seven-day session (CLAUDE.md), and the middleware does
 * not run on `/api`, so the check here is the only one — and the whole one.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== "admin" && session.role !== "assistant")) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const event = await prisma.event.findUnique({ where: { id: session.eventId }, select: { playSuspendedAt: true } });
  return NextResponse.json({ ok: true, since: event?.playSuspendedAt?.toISOString() ?? "" }, { headers: NO_STORE });
}
