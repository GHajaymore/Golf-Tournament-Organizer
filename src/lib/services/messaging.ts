import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import {
  scopeKey,
  parseScopeKey,
  visibleScopes,
  canPostToScope,
  canReadScope,
  teeGroupId,
  directKeyFor,
  sortThreads,
  unreadCount,
  cleanMessageBody,
  SCOPE_LABEL,
  MAX_TITLE_LENGTH,
  type MembershipContext,
  type ScopeKey,
  type ScopeKind,
} from "@/lib/domain/messaging";

/**
 * Reading and writing conversations.
 *
 * The one rule this file exists to keep: **no query is ever filtered by a
 * thread id the caller supplied.** Every read starts from
 * `visibleScopes(context)` — the set of conversations derived from where this
 * person actually sits in the tournament — and filters to it. A thread id off
 * the wire is only ever used *in addition to* that filter, never instead of
 * it, so an id belonging to somebody else's flight returns nothing rather than
 * relying on a check that a future edit might drop.
 *
 * See domain/messaging.ts for the permission rules themselves, which are pure
 * and tested without a database.
 */

/**
 * Where one person sits in one tournament.
 *
 * Every field is read from the database under a scope key — event id, or the
 * caller's own email — so nothing here can be influenced by an argument.
 */
export async function membershipFor(
  eventId: string,
  email: string,
  role: "admin" | "assistant" | "player",
): Promise<MembershipContext | null> {
  const key = email.trim().toLowerCase();
  if (!key) return null;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, organizationId: true },
  });
  if (!event) return null;

  const [player, member, directs] = await Promise.all([
    prisma.player.findFirst({
      where: { eventId, email: { equals: key, mode: "insensitive" } },
      select: { id: true, groupId: true },
    }),
    prisma.member.findFirst({
      where: { organizationId: event.organizationId, email: { equals: key, mode: "insensitive" } },
      select: { id: true },
    }),
    // The thread's OWN scope key, not its id. A direct thread is scoped
    // `direct:<sorted participant emails>` so that both people compute the
    // same key — putting the thread id here instead would build a scope
    // nothing is stored under, and every direct conversation would be
    // invisible to everyone including the people in it.
    prisma.threadParticipant.findMany({
      where: { email: key },
      select: { thread: { select: { scopeKey: true } } },
    }),
  ]);

  const playerId = player?.id ?? null;

  // Rounds this person is actually in, teams they are on, matches they play,
  // and the tee-sheet groups they appear in. All keyed from their own player
  // id — which came from the query above, not from a parameter.
  const [teamRows, matchRows, stages] = playerId
    ? await Promise.all([
        prisma.teamMember.findMany({
          where: { playerId },
          select: { teamId: true, team: { select: { stageId: true } } },
        }),
        prisma.match.findMany({
          where: { eventId, OR: [{ playerAId: playerId }, { playerBId: playerId }] },
          select: { id: true, stageId: true },
        }),
        prisma.stage.findMany({ where: { eventId }, select: { id: true, teeSheet: true } }),
      ])
    : [[], [], []];

  const teamIds = teamRows.map((t) => t.teamId);
  const matchIds = matchRows.map((m) => m.id);

  // A team match has empty player columns, so rounds reached through a side
  // count too — otherwise a four-ball partner is not "in" their own round.
  const teamMatchStageIds = playerId
    ? (
        await prisma.match.findMany({
          where: {
            eventId,
            OR: [{ teamAId: { in: teamIds } }, { teamBId: { in: teamIds } }],
          },
          select: { id: true, stageId: true },
        })
      ).map((m) => {
        matchIds.push(m.id);
        return m.stageId;
      })
    : [];

  const foursomeIds: string[] = [];
  for (const stage of stages) {
    const sheet = parseTeeSheet(stage.teeSheet);
    if (!sheet || !playerId) continue;
    for (const g of sheet.groups) {
      if (g.playerIds.includes(playerId)) foursomeIds.push(teeGroupId(stage.id, g.name));
    }
  }

  const stageIds = [
    ...new Set([
      ...matchRows.map((m) => m.stageId),
      ...teamMatchStageIds,
      ...teamRows.map((t) => t.team?.stageId).filter((s): s is string => !!s),
      // A stroke-play round has no matches at all, so being in the field is
      // what puts a player in it. Without this, the commonest format in the
      // product has no round conversation. Being entered is therefore the
      // whole test — the match and team lists above only ADD rounds for
      // someone who somehow has a match without being in the field.
      ...(playerId ? stages.map((s) => s.id) : []),
    ]),
  ];

  return {
    email: key,
    role,
    organizationId: event.organizationId,
    eventId,
    playerId,
    onRoster: !!member || !!playerId || role !== "player",
    groupIds: player?.groupId ? [player.groupId] : [],
    stageIds,
    teamIds,
    matchIds: [...new Set(matchIds)],
    foursomeIds,
    directThreadIds: directs
      .map((d) => parseScopeKey(d.thread.scopeKey))
      .filter((p): p is { kind: ScopeKind; id: string } => p?.kind === "direct")
      .map((p) => p.id),
  };
}

/**
 * A thread's id is derived from its scope rather than generated.
 *
 * Two reasons. It makes "open the conversation for my four" an upsert on the
 * primary key, which is atomic — two players opening it at the same moment
 * cannot create two threads that each hold half the messages. And it means a
 * scope has exactly one conversation, which is the model that matches how
 * these are actually used: a channel per place you stand, not a forum.
 */
export function threadIdFor(organizationId: string, eventId: string | null, key: ScopeKey): string {
  const hash = createHash("sha256").update(`${organizationId}|${eventId ?? ""}|${key}`).digest("hex");
  return `th_${hash.slice(0, 24)}`;
}

/** Club threads outlive any one tournament, so they hang off the org alone. */
function eventIdForScope(kind: ScopeKind, eventId: string): string | null {
  return kind === "club" ? null : eventId;
}

export interface ThreadListItem {
  id: string;
  scopeKey: ScopeKey;
  kind: ScopeKind;
  title: string;
  label: string;
  lastMessageAt: number;
  unread: number;
  canPost: boolean;
  preview: string;
}

/**
 * Every conversation this person can see, most useful first.
 *
 * The `scopeKey in visibleScopes` filter is the whole access check. There is
 * no second query that could forget it.
 */
export async function threadsFor(ctx: MembershipContext): Promise<ThreadListItem[]> {
  const keys = visibleScopes(ctx);
  if (keys.length === 0) return [];

  const threads = await prisma.thread.findMany({
    where: {
      organizationId: ctx.organizationId,
      scopeKey: { in: keys },
      archived: false,
      // A club thread has no event; everything else must belong to this one.
      OR: [{ eventId: ctx.eventId }, { eventId: null }],
    },
    orderBy: { lastMessageAt: "desc" },
  });
  if (threads.length === 0) return [];

  const ids = threads.map((t) => t.id);
  const [messages, reads] = await Promise.all([
    prisma.message.findMany({
      where: { threadId: { in: ids }, deletedAt: null },
      select: { threadId: true, createdAt: true, authorEmail: true, body: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.threadRead.findMany({ where: { threadId: { in: ids }, email: ctx.email } }),
  ]);

  const byThread = new Map<string, typeof messages>();
  for (const m of messages) {
    const list = byThread.get(m.threadId) ?? [];
    list.push(m);
    byThread.set(m.threadId, list);
  }
  const readAt = new Map(reads.map((r) => [r.threadId, r.lastReadAt.getTime()]));

  const items = threads.map((t) => {
    const msgs = byThread.get(t.id) ?? [];
    const parsed = parseScopeKey(t.scopeKey);
    const kind = (parsed?.kind ?? "event") as ScopeKind;
    const last = msgs[msgs.length - 1];
    return {
      id: t.id,
      scopeKey: t.scopeKey,
      kind,
      title: t.title || SCOPE_LABEL[kind],
      label: SCOPE_LABEL[kind],
      lastMessageAt: t.lastMessageAt.getTime(),
      unread: unreadCount(
        msgs.map((m) => ({ createdAt: m.createdAt.getTime(), authorEmail: m.authorEmail })),
        ctx.email,
        readAt.get(t.id) ?? null,
      ),
      canPost: canPostToScope(ctx, t.scopeKey),
      // First line only, and short — the list is read on a phone.
      preview: last ? last.body.split("\n")[0].slice(0, 110) : "",
    };
  });

  const order = sortThreads(items);
  const byId = new Map(items.map((i) => [i.id, i]));
  return order.map((o) => byId.get(o.id)!);
}

export interface ThreadMessage {
  id: string;
  authorEmail: string;
  authorName: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  mine: boolean;
}

export interface ThreadView {
  id: string;
  scopeKey: ScopeKey;
  kind: ScopeKind;
  title: string;
  label: string;
  canPost: boolean;
  messages: ThreadMessage[];
}

/**
 * One conversation, or null.
 *
 * Null covers both "no such thread" and "not yours" deliberately: a distinct
 * error for the second would confirm that a thread with that id exists, which
 * is the thing the caller is not entitled to know.
 */
export async function threadView(ctx: MembershipContext, threadId: string): Promise<ThreadView | null> {
  const keys = visibleScopes(ctx);
  if (keys.length === 0) return null;

  // Scoped by the derived set AND the org, in the same where clause. The id is
  // a narrowing argument, never the authorisation.
  const thread = await prisma.thread.findFirst({
    where: {
      id: threadId,
      organizationId: ctx.organizationId,
      scopeKey: { in: keys },
      OR: [{ eventId: ctx.eventId }, { eventId: null }],
    },
  });
  if (!thread) return null;

  const messages = await prisma.message.findMany({
    where: { threadId: thread.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  const parsed = parseScopeKey(thread.scopeKey);
  const kind = (parsed?.kind ?? "event") as ScopeKind;
  return {
    id: thread.id,
    scopeKey: thread.scopeKey,
    kind,
    title: thread.title || SCOPE_LABEL[kind],
    label: SCOPE_LABEL[kind],
    canPost: canPostToScope(ctx, thread.scopeKey),
    messages: messages.map((m) => ({
      id: m.id,
      authorEmail: m.authorEmail,
      authorName: m.authorName,
      body: m.body,
      createdAt: m.createdAt.getTime(),
      editedAt: m.editedAt?.getTime() ?? null,
      mine: m.authorEmail.trim().toLowerCase() === ctx.email,
    })),
  };
}

export interface PostResult {
  ok: boolean;
  error?: string;
  threadId?: string;
}

/**
 * Post to a scope, creating its conversation if this is the first message.
 *
 * Takes a SCOPE, not a thread id. That is the safe direction: a scope is
 * checked against the derived set before anything is written, and the thread
 * id is computed from it rather than accepted.
 */
export async function postToScope(
  ctx: MembershipContext,
  key: ScopeKey,
  body: string,
  authorName: string,
  title = "",
): Promise<PostResult> {
  const parsed = parseScopeKey(key);
  if (!parsed) return { ok: false, error: "Unknown conversation." };
  if (!canPostToScope(ctx, key)) return { ok: false, error: "You can't post there." };

  const clean = cleanMessageBody(body);
  if (!clean.ok) return { ok: false, error: clean.error };

  const eventId = eventIdForScope(parsed.kind, ctx.eventId);
  const id = threadIdFor(ctx.organizationId, eventId, key);
  const now = new Date();

  // Upsert on the primary key, so two people opening the same conversation at
  // the same moment cannot create two of it.
  await prisma.thread.upsert({
    where: { id },
    create: {
      id,
      organizationId: ctx.organizationId,
      eventId,
      scopeKey: key,
      title: title.trim().slice(0, MAX_TITLE_LENGTH),
      createdByEmail: ctx.email,
      createdByName: authorName,
      lastMessageAt: now,
    },
    update: { lastMessageAt: now, archived: false },
  });

  await prisma.message.create({
    data: { threadId: id, authorEmail: ctx.email, authorName, body: clean.text, createdAt: now },
  });

  // Posting is seeing: their own message must not come back as unread.
  await markRead(ctx, id);
  return { ok: true, threadId: id };
}

/** Move this reader's watermark to now. Silently does nothing for a thread
 *  they cannot see, which is the same answer as reading it. */
export async function markRead(ctx: MembershipContext, threadId: string): Promise<void> {
  if (!(await threadView(ctx, threadId))) return;
  await prisma.threadRead.upsert({
    where: { threadId_email: { threadId, email: ctx.email } },
    create: { threadId, email: ctx.email, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

/**
 * Start or find a direct conversation with named people.
 *
 * The other participants must be in the same tournament — checked here rather
 * than trusted, because these emails DO come from the caller. Without it this
 * would be an open message-anybody endpoint, and the address book is the whole
 * club.
 */
export async function openDirectThread(
  ctx: MembershipContext,
  withEmails: string[],
  authorName: string,
  firstMessage = "",
): Promise<PostResult> {
  const wanted = [...new Set(withEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))].filter(
    (e) => e !== ctx.email,
  );
  if (wanted.length === 0) return { ok: false, error: "Pick somebody to message." };
  if (wanted.length > 20) return { ok: false, error: "That's too many people for one conversation." };

  // Everyone addressed has to be in this tournament or on this club's roster.
  const [players, members] = await Promise.all([
    prisma.player.findMany({
      where: { eventId: ctx.eventId, email: { in: wanted, mode: "insensitive" } },
      select: { email: true },
    }),
    prisma.member.findMany({
      where: { organizationId: ctx.organizationId, email: { in: wanted, mode: "insensitive" } },
      select: { email: true },
    }),
  ]);
  const reachable = new Set(
    [...players, ...members].map((r) => r.email.trim().toLowerCase()).filter(Boolean),
  );
  const unreachable = wanted.filter((e) => !reachable.has(e));
  if (unreachable.length > 0) {
    // Named rather than counted: the organizer needs to know which address was
    // wrong, and every name here is already someone they can see.
    return { ok: false, error: `Not in this tournament: ${unreachable.join(", ")}` };
  }

  // Anyone who has opted out of being messaged. Checked here and not only in
  // the picker, because the picker is a list in a browser and this is the
  // endpoint. Staff are not exempt: an organizer who needs to reach this
  // person has the tournament and flight threads, which the opt-out
  // deliberately does not touch.
  const optedOut = await prisma.member.findMany({
    where: { organizationId: ctx.organizationId, email: { in: wanted, mode: "insensitive" }, messagesOptOut: true },
    select: { name: true },
  });
  if (optedOut.length > 0) {
    return {
      ok: false,
      error: `${optedOut.map((m) => m.name).join(", ")} ${optedOut.length === 1 ? "has" : "have"} turned off direct messages.`,
    };
  }

  const participants = [...wanted, ctx.email];
  const key = scopeKey("direct", directKeyFor(participants));
  const id = threadIdFor(ctx.organizationId, ctx.eventId, key);

  await prisma.thread.upsert({
    where: { id },
    create: {
      id,
      organizationId: ctx.organizationId,
      eventId: ctx.eventId,
      scopeKey: key,
      createdByEmail: ctx.email,
      createdByName: authorName,
    },
    update: { archived: false },
  });

  // Participant rows are what make a direct thread visible — this is the one
  // scope whose membership is stored, because there is no structure to derive
  // it from.
  for (const email of participants) {
    await prisma.threadParticipant.upsert({
      where: { threadId_email: { threadId: id, email } },
      create: { threadId: id, email },
      update: {},
    });
  }

  // Opening a conversation almost always means writing to it, and the caller's
  // membership context was built before the participant rows above existed —
  // so a second call using that same context would be told it cannot post to
  // the thread it just created. Writing the first message here avoids the
  // round trip and the stale-context trap. It is safe without re-deriving:
  // every participant was verified against this tournament immediately above,
  // and the author is one of them by construction.
  if (firstMessage.trim()) {
    const clean = cleanMessageBody(firstMessage);
    if (!clean.ok) return { ok: false, error: clean.error };
    const now = new Date();
    await prisma.message.create({
      data: { threadId: id, authorEmail: ctx.email, authorName, body: clean.text, createdAt: now },
    });
    await prisma.thread.update({ where: { id }, data: { lastMessageAt: now } });
    await prisma.threadRead.upsert({
      where: { threadId_email: { threadId: id, email: ctx.email } },
      create: { threadId: id, email: ctx.email, lastReadAt: now },
      update: { lastReadAt: now },
    });
  }

  return { ok: true, threadId: id };
}

/**
 * Whether this person has turned off direct messages, and setting it.
 *
 * Read from the club roster by email, because that is where the preference
 * lives — see Member.messagesOptOut. Somebody entered in a tournament who is
 * not on the roster has no row to carry a preference, and defaults to
 * reachable; adding them to the roster is what the registration path already
 * does.
 */
export async function messagesOptOutFor(ctx: MembershipContext): Promise<boolean> {
  const member = await prisma.member.findFirst({
    where: { organizationId: ctx.organizationId, email: { equals: ctx.email, mode: "insensitive" } },
    select: { messagesOptOut: true },
  });
  return member?.messagesOptOut ?? false;
}

export async function setMessagesOptOut(ctx: MembershipContext, optOut: boolean): Promise<boolean> {
  // Scoped to the caller's OWN email and their own club. There is no id
  // parameter here at all, so this cannot be pointed at anybody else.
  const res = await prisma.member.updateMany({
    where: { organizationId: ctx.organizationId, email: { equals: ctx.email, mode: "insensitive" } },
    data: { messagesOptOut: optOut },
  });
  return res.count > 0;
}

/**
 * The address book, minus anyone who has opted out.
 *
 * Callers used to build this from the Player table directly, which meant the
 * opt-out was enforced at the endpoint but the person still appeared in the
 * dropdown — an opt-out you can see being refused is not much of one.
 */
export async function messageableField(
  ctx: MembershipContext,
): Promise<{ name: string; email: string }[]> {
  const [field, optedOut] = await Promise.all([
    prisma.player.findMany({
      where: { eventId: ctx.eventId, email: { not: "" } },
      select: { name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.member.findMany({
      where: { organizationId: ctx.organizationId, messagesOptOut: true },
      select: { email: true },
    }),
  ]);
  const off = new Set(optedOut.map((m) => m.email.trim().toLowerCase()).filter(Boolean));
  return field.filter((p) => {
    const e = p.email.trim().toLowerCase();
    return e !== ctx.email && !off.has(e);
  });
}

/**
 * Total unread across everything this person can see — the badge on the nav.
 */
export async function unreadTotal(ctx: MembershipContext): Promise<number> {
  const threads = await threadsFor(ctx);
  return threads.reduce((sum, t) => sum + t.unread, 0);
}

/**
 * The scopes this person may START a conversation in, for the compose picker.
 *
 * Derived the same way as everything else, and labelled with what the scope
 * actually is in this tournament — "Flight A", not "flight".
 */
export async function composableScopes(
  ctx: MembershipContext,
): Promise<{ key: ScopeKey; label: string; kind: ScopeKind }[]> {
  const out: { key: ScopeKey; label: string; kind: ScopeKind }[] = [];
  const keys = visibleScopes(ctx).filter((k) => canPostToScope(ctx, k));

  const [groups, stages, teams] = await Promise.all([
    prisma.group.findMany({ where: { eventId: ctx.eventId }, select: { id: true, name: true } }),
    prisma.stage.findMany({
      where: { eventId: ctx.eventId },
      select: { id: true, type: true, description: true, position: true },
      orderBy: { position: "asc" },
    }),
    prisma.team.findMany({ where: { eventId: ctx.eventId }, select: { id: true, name: true } }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const stageName = new Map(stages.map((s) => [s.id, s.description?.trim() || s.type]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  for (const key of keys) {
    const parsed = parseScopeKey(key);
    if (!parsed) continue;
    const { kind, id } = parsed;
    let label = SCOPE_LABEL[kind];
    if (kind === "flight") label = `Flight ${groupName.get(id) ?? ""}`.trim();
    if (kind === "round") label = stageName.get(id) ?? "Round";
    if (kind === "team") label = teamName.get(id) ?? "Your team";
    if (kind === "foursome") label = `Your group — ${id.split("#")[1] ?? ""}`.trim();
    if (kind === "direct") continue; // has its own picker
    out.push({ key, label, kind });
  }
  return out;
}

/**
 * Staff broadcast: post to a scope the organizer names.
 *
 * Separate from `postToScope` because an organizer legitimately writes to
 * flights and rounds they are not personally in — that is what running a
 * tournament is. The widening is bounded to the tournament they already have
 * staff access to, and to the structural scopes only: it can never reach a
 * private four's conversation or a direct message.
 */
const BROADCASTABLE: ScopeKind[] = ["club", "event", "staff", "flight", "round", "team"];

export async function staffBroadcast(
  ctx: MembershipContext,
  key: ScopeKey,
  body: string,
  authorName: string,
): Promise<PostResult> {
  if (ctx.role !== "admin" && ctx.role !== "assistant") {
    return { ok: false, error: "Organizers only." };
  }
  const parsed = parseScopeKey(key);
  if (!parsed || !BROADCASTABLE.includes(parsed.kind)) {
    return { ok: false, error: "You can't broadcast there." };
  }

  // The named scope must belong to THIS tournament. Without this an organizer
  // of one event could post into another club's flight by id — the same
  // cross-tenant hole the IDOR sweep exists to catch.
  if (parsed.kind === "flight") {
    const g = await prisma.group.findFirst({ where: { id: parsed.id, eventId: ctx.eventId } });
    if (!g) return { ok: false, error: "That flight isn't in this tournament." };
  }
  if (parsed.kind === "round") {
    const s = await prisma.stage.findFirst({ where: { id: parsed.id, eventId: ctx.eventId } });
    if (!s) return { ok: false, error: "That round isn't in this tournament." };
  }
  if (parsed.kind === "team") {
    const t = await prisma.team.findFirst({ where: { id: parsed.id, eventId: ctx.eventId } });
    if (!t) return { ok: false, error: "That team isn't in this tournament." };
  }

  const clean = cleanMessageBody(body);
  if (!clean.ok) return { ok: false, error: clean.error };

  const eventId = eventIdForScope(parsed.kind, ctx.eventId);
  const id = threadIdFor(ctx.organizationId, eventId, key);
  const now = new Date();

  await prisma.thread.upsert({
    where: { id },
    create: {
      id,
      organizationId: ctx.organizationId,
      eventId,
      scopeKey: key,
      createdByEmail: ctx.email,
      createdByName: authorName,
      lastMessageAt: now,
    },
    update: { lastMessageAt: now, archived: false },
  });
  await prisma.message.create({
    data: { threadId: id, authorEmail: ctx.email, authorName, body: clean.text, createdAt: now },
  });
  return { ok: true, threadId: id };
}

/** Re-exported so callers have one import for the whole feature. */
export { canReadScope, scopeKey, SCOPE_LABEL };
