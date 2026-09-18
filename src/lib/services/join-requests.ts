import "server-only";
import { prisma } from "../db";

/**
 * ASKING TO BE LET IN, AND THE CLUB ANSWERING.
 *
 * The reads behind the request-to-join. The rules about WHICH outfit somebody
 * may ask to join live in `organization.ts` beside the same-name warning,
 * because they are the same rules: you may ask to join the outfit the app
 * itself just told you about, and nothing else. There is deliberately no
 * search — a search box is a directory of every club on TourneyHQ, and that is
 * not a thing to hand out in exchange for a sign-up.
 */

export interface PendingAsk {
  id: string;
  name: string;
  /**
   * The asker's email, shown to the club and to nobody else.
   *
   * The asymmetry is the design, not an oversight: the person asking never
   * learns the owner's address, and the owner does learn theirs. They chose to
   * approach the club, and no one can sensibly decide whether to hand somebody
   * the keys without knowing who they are.
   */
  email: string;
  note: string;
  askedAt: Date;
}

/** Who is waiting on an answer from this outfit, oldest first. */
export async function pendingAsks(organizationId: string): Promise<PendingAsk[]> {
  const rows = await prisma.joinRequest.findMany({
    where: { organizationId, status: "pending" },
    select: {
      id: true,
      note: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.user.name?.trim() || r.user.email,
    email: r.user.email,
    note: r.note,
    askedAt: r.createdAt,
  }));
}

export interface MyAsk {
  status: string;
  outfit: string;
  askedAt: Date;
  decidedAt: Date | null;
}

/**
 * What THIS person has already asked, so the screen can say "asked two days
 * ago, no answer yet" instead of offering the same button again.
 *
 * NOBODY IS EVER STUCK WAITING. A request that blocks somebody from setting up
 * their own outfit would be worse than no request at all: they came here to
 * run a tournament on Thursday, and a secretary who does not check their email
 * until Sunday must not be able to stop them. The screen keeps "create a
 * separate one anyway" beside this.
 */
export async function myAsks(email: string): Promise<MyAsk[]> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return [];
  const rows = await prisma.joinRequest.findMany({
    where: { userId: user.id },
    select: {
      status: true,
      createdAt: true,
      decidedAt: true,
      organization: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    status: r.status,
    outfit: r.organization.name,
    askedAt: r.createdAt,
    decidedAt: r.decidedAt,
  }));
}
