"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { refusalFor } from "@/lib/services/limits";
import { organizationAccess } from "@/lib/services/org-access";
import { clubNameClash } from "@/lib/services/organization";
import { sendJoinRequestEmail } from "@/lib/email";

/**
 * ASKING A CLUB TO LET YOU IN, AND THE CLUB ANSWERING.
 *
 * The other half of the same-name warning. That warning tells the second
 * secretary of a Thursday league "ask them to add you", names who runs it, and
 * then stops — they have to find a phone number, and the app will not give
 * them one. This is the ask, made in the app.
 *
 * WHICH OUTFIT, WITHOUT AN ID FROM THE CALLER. `askToJoinNamesake` takes the
 * NAME the person typed and resolves it exactly as the warning did: same
 * matcher, same area rule, never a `personal` tenant. A "use server" export is
 * a public HTTP endpoint, so an organization id posted from a form is how
 * somebody asks to join a club they have never seen — there is no such
 * parameter here, and that is why.
 *
 * And there is no search. A "find my club" box is a directory of every outfit
 * on TourneyHQ, handed to anybody who signs up; you may ask to join the one
 * the app itself just told you about, and nothing else.
 */

export interface JoinResult {
  ok: boolean;
  error?: string;
  /** What to tell them when it worked — names the outfit they asked. */
  asked?: string;
}

/** The roles an approval may grant. Admin is the default the screen offers. */
const GRANTABLE = ["admin", "member", "guest"] as const;
type Grantable = (typeof GRANTABLE)[number];
const cleanGrant = (r: string): Grantable =>
  (GRANTABLE as readonly string[]).includes(r) ? (r as Grantable) : "member";

export async function askToJoinNamesake(orgName: string, note: string): Promise<JoinResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const wanted = orgName.trim();
  if (!wanted) return { ok: false, error: "Type the name of the club you are asking to join." };

  /**
   * COUNTED BEFORE THE LOOKUP, like every other limiter in this app: a refusal
   * then costs the caller a query they do not get, and tells them nothing about
   * whether the outfit they typed exists.
   */
  const limit = await checkRateLimit("join-request", session.email);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const outfit = await clubNameClash(session.email, session.name, wanted, null);
  if (!outfit) {
    // Either nothing of that name is near them, or the name is their own. Said
    // plainly rather than as "not found", which reads like a broken feature.
    return { ok: false, error: "There is no club of that name here to ask." };
  }

  const user = await prisma.user.findUnique({ where: { email: session.email }, select: { id: true } });
  if (!user) return { ok: false, error: "Sign in first." };

  const already = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: outfit.organizationId, userId: user.id } },
    select: { id: true },
  });
  if (already) return { ok: false, error: `You are already in ${outfit.name}.` };

  /**
   * ONE ROW PER PERSON PER OUTFIT. A second ask REOPENS the first rather than
   * stacking, so a club never opens its access screen to six copies of one
   * person — and a previously declined ask becomes pending again, which is the
   * behaviour somebody who was declined by mistake needs. The rate limit above
   * is what stops that being a way to pester anybody.
   */
  const existing = await prisma.joinRequest.findUnique({
    where: { organizationId_userId: { organizationId: outfit.organizationId, userId: user.id } },
    select: { id: true, status: true },
  });
  if (existing?.status === "pending") {
    return { ok: false, error: `You have already asked ${outfit.name}. They have not answered yet.` };
  }

  await prisma.joinRequest.upsert({
    where: { organizationId_userId: { organizationId: outfit.organizationId, userId: user.id } },
    update: { note: note.trim().slice(0, 300), status: "pending", createdAt: new Date(), decidedAt: null, decidedBy: "", decidedRole: "" },
    create: {
      organizationId: outfit.organizationId,
      userId: user.id,
      note: note.trim().slice(0, 300),
    },
  });

  /**
   * The owners hear about it by email as well as on the screen, because a club
   * secretary does not sign in on a Tuesday to see whether anybody asked.
   *
   * Awaited but unable to fail this action — the sender swallows its own
   * errors, and the row is already written. A request that failed to notify
   * still exists and will be seen; a request that failed to WRITE because mail
   * bounced would be a person who thinks they asked and did not.
   */
  const owners = await prisma.organizationMember.findMany({
    where: { organizationId: outfit.organizationId, role: { in: ["owner", "admin"] } },
    select: { user: { select: { email: true, name: true } } },
  });
  for (const o of owners) {
    await sendJoinRequestEmail(o.user.email, {
      organizationName: outfit.name,
      askerName: session.name || session.email,
      askerEmail: session.email,
      note: note.trim().slice(0, 300),
      toName: o.user.name ?? "",
    });
  }

  revalidatePath("/", "layout");
  return { ok: true, asked: outfit.name };
}

/**
 * Let somebody in — the club's decision, in the club's words.
 *
 * ADMIN BY DEFAULT ON THE SCREEN, and the reason is who sends these: the
 * person asking is the league's other organizer, not a spectator. Approve them
 * as a Member and they can see the calendar and run nothing, so they go back
 * and build their own outfit anyway and the split happens one step later,
 * which is the whole thing the warning exists to prevent.
 *
 * An Admin costs a staff seat, so this runs the same plan check adding staff
 * runs — and when it refuses, it refuses by NAME, because "seat limit reached"
 * beside a person's request is the moment to say who cannot be added and what
 * the alternatives are.
 */
export async function approveJoinRequest(requestId: string, role: string): Promise<JoinResult> {
  const org = await organizationAccess(await getSession());
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can answer this." };

  /**
   * NARROWED TO THE CALLER'S OWN OUTFIT before it is used for anything. The id
   * arrives from a form; scoping the query by `organizationId` is what stops it
   * being another club's request answered from this screen.
   */
  const ask = await prisma.joinRequest.findFirst({
    where: { id: requestId, organizationId: org.organizationId, status: "pending" },
    select: { id: true, userId: true, user: { select: { name: true, email: true } } },
  });
  if (!ask) return { ok: false, error: "That request is no longer waiting for an answer." };

  const granted = cleanGrant(role);
  if (granted === "admin") {
    const refusal = await refusalFor(org.organizationId, "staffSeats");
    if (refusal) {
      const who = ask.user.name?.trim() || ask.user.email;
      return {
        ok: false,
        error: `${refusal} ${who} can be added as a Member without a seat — they will see the calendar but not run tournaments.`,
      };
    }
  }

  const session = await getSession();
  await prisma.$transaction([
    prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.organizationId, userId: ask.userId } },
      update: { role: granted },
      create: { organizationId: org.organizationId, userId: ask.userId, role: granted },
    }),
    prisma.joinRequest.update({
      where: { id: ask.id },
      data: {
        status: "approved",
        decidedAt: new Date(),
        // By NAME, so a club can see who let somebody in. Same reason the
        // play-off override records who overturned it.
        decidedBy: session?.name || session?.email || "",
        decidedRole: granted,
      },
    }),
  ]);

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Say no.
 *
 * The row is KEPT rather than deleted. It is what stops the same person asking
 * every morning, and a decision one person made about another is not a thing
 * to erase quietly. They can ask again — the rate limit is what makes that
 * bearable — and a club that declined by mistake sees the new ask.
 */
export async function declineJoinRequest(requestId: string): Promise<JoinResult> {
  const org = await organizationAccess(await getSession());
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can answer this." };

  const ask = await prisma.joinRequest.findFirst({
    where: { id: requestId, organizationId: org.organizationId, status: "pending" },
    select: { id: true },
  });
  if (!ask) return { ok: false, error: "That request is no longer waiting for an answer." };

  const session = await getSession();
  await prisma.joinRequest.update({
    where: { id: ask.id },
    data: {
      status: "declined",
      decidedAt: new Date(),
      decidedBy: session?.name || session?.email || "",
    },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
