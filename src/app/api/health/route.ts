import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * IS TOURNEYHQ UP — for an uptime monitor to ask every minute (2026-10-02).
 *
 * The front page is the wrong thing to watch. It renders from the landing
 * module with no query on it, so it answers 200 while the database is
 * unreachable — and an unreachable database is the outage this app has
 * actually had (CLAUDE.md, "the other way `deploy` fails"). Every screen a
 * club uses reads the database, so this asks it one trivial question and says
 * 503 when it cannot answer in time.
 *
 * It says NOTHING else. No error text, no host, no timing: an open endpoint
 * that echoes a connection error is a map of the infrastructure for anyone
 * who asks. The monitor needs a status code, and that is all it gets.
 */

export const dynamic = "force-dynamic";

/**
 * Long enough for a cold pooled connection, short enough to call it down.
 * Not exported: a route file may export only handlers and route config, and
 * Next's generated types refuse anything else.
 */
const HEALTH_TIMEOUT_MS = 4000;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT_MS);
      }),
    ]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  } finally {
    clearTimeout(timer);
  }
}
