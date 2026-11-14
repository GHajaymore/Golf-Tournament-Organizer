import { byAddress } from "@/lib/domain/my-entry";
import { orgProfile } from "@/lib/domain/org-profile";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { roundLabelWith } from "@/lib/domain/round-label";
import {
  canFanOutToSms,
  composeSms,
  planFanOut,
  normalizePhone,
  samePhone,
  inboundIntent,
  estimateCost,
  formatCost,
  type SmsRecipient,
} from "@/lib/domain/sms";
import { sendSms, smsConfig } from "@/lib/sms";
import { METERED_FEATURES } from "@/lib/plans";
import { organizationAllows } from "@/lib/services/entitlements";
import { flightLabel } from "@/lib/domain/flight-label";
import {
  scopeKey,
  parseScopeKey,
  outwardScopeKey,
  threadInOutwardKey,
  visibleScopes,
  canPostToScope,
  canReadScope,
  teeGroupId,
  directKeyFor,
  sortThreads,
  unreadCount,
  cleanMessageBody,
  SCOPE_LABEL,
  scopeLabel,
  MAX_TITLE_LENGTH,
  guestWhoKey,
  isGuestKey,
  playerOfGuestKey,
  whoKeysForEntry,
  type MembershipContext,
  type ScopeKey,
  type ScopeKind,
} from "@/lib/domain/messaging";
import { isGuest } from "@/lib/domain/entry-standing";
import type { GuestIdentity } from "@/lib/domain/player-link";
import { myPlayerIdsFor } from "@/lib/services/me";

/** The words a muted guest is given where they tried to post (S8). */
export const MUTED_WORDS = "Your organizer has turned off your posts here. You can still message the organizer.";

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
 * WHO IS ASKING, as messaging needs it: an account (its proved email and its
 * role), or a guest's player link (`guest`, from the pass, never an argument).
 * A `PlayerViewer` and a `Session` are both one.
 */
export interface MessagingViewer {
  email: string;
  role: "admin" | "assistant" | "player";
  guest?: GuestIdentity | null;
}

/**
 * Where one person sits in one tournament.
 *
 * Every field is read from the database under a scope key — event id, or the
 * caller's own who-key — so nothing here can be influenced by an argument.
 *
 * TAKES THE VIEWER (J39/J40 PR 2), so the compiler listed every caller the day
 * a guest's link joined messaging. An account is found by its email, exactly
 * as before; a guest by the pass's own entry, only in the pass's own event and
 * only while that entry is confirmed (`myPlayerIdsFor`, S5) — a waiting guest
 * gets no context at all.
 */
export async function membershipFor(viewer: MessagingViewer, eventId: string): Promise<MembershipContext | null> {
  if (viewer.guest) return guestMembershipFor(viewer.guest, eventId);
  const role = viewer.role;
  const key = viewer.email.trim().toLowerCase();
  if (!key) return null;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    // The organization's KIND rides along on a query that already runs, so a
    // society's message scopes can be called what they are. See orgNoun.
    select: {
      id: true,
      organizationId: true,
      // `country` and `communityNoun` beside the kind: the kind alone cannot
      // know what the outfit CALLS itself, and `orgNoun` below is read into
      // sentences a player sees.
      organization: { select: { kind: true, country: true, communityNoun: true } },
    },
  });
  if (!event) return null;

  const [player, member, directs] = await Promise.all([
    prisma.player.findFirst({
      where: { eventId, ...byAddress(key) },
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
      where: { whoKey: key },
      select: { thread: { select: { scopeKey: true } } },
    }),
  ]);

  return contextFrom({
    event,
    eventId,
    role,
    whoKey: key,
    guest: false,
    muted: false,
    player,
    onRoster: !!member || !!player || role !== "player",
    directs,
  });
}

/**
 * A GUEST'S PLACE IN THE EVENT (J39/J40 PR 2). The entry is the pass's own,
 * re-read here and admitted only while confirmed (`myPlayerIdsFor`, S5); the
 * who-key is `guest:<playerId>`; the club's threads are never theirs (`guest`,
 * read by `visibleScopes`); and `muted` is the organizer's Mute (S8).
 */
async function guestMembershipFor(guest: GuestIdentity, eventId: string): Promise<MembershipContext | null> {
  if (guest.eventId !== eventId) return null;
  const mine = await myPlayerIdsFor({ email: "", guest }, eventId);
  if (!mine.has(guest.playerId)) return null;
  const whoKey = guestWhoKey(guest.playerId);
  const [event, player, pass, directs] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true, organization: { select: { kind: true, country: true, communityNoun: true } } },
    }),
    prisma.player.findFirst({ where: { id: guest.playerId, eventId }, select: { id: true, groupId: true } }),
    prisma.playerPass.findUnique({ where: { id: guest.passId }, select: { mutedAt: true } }),
    prisma.threadParticipant.findMany({ where: { whoKey }, select: { thread: { select: { scopeKey: true } } } }),
  ]);
  if (!event || !player) return null;
  return contextFrom({ event, eventId, role: "player", whoKey, guest: true, muted: !!pass?.mutedAt, player, onRoster: false, directs });
}

/** The rest of a context, the same for an account and a guest: everything keyed from the entry found above. */
async function contextFrom(f: {
  event: { id: string; organizationId: string; organization: { kind: string; country: string; communityNoun: string } };
  eventId: string;
  role: "admin" | "assistant" | "player";
  whoKey: string;
  guest: boolean;
  muted: boolean;
  player: { id: string; groupId: string | null } | null;
  onRoster: boolean;
  directs: { thread: { scopeKey: string } }[];
}): Promise<MembershipContext> {
  const { event, eventId, role, player, directs } = f;
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

  /**
   * The structures an organizer administers, so they can READ what they are
   * already allowed to WRITE. See `MembershipContext.staffScopes`.
   *
   * Queried only for staff — a player must not pay for a lookup that can only
   * ever produce an empty list for them — and scoped to this event by every
   * `where` below, which is the bound on the widening.
   */
  const isStaff = role === "admin" || role === "assistant";
  const [allGroups, allStages, allTeams, allPlayers] = isStaff
    ? await Promise.all([
        /**
         * Ordered, because `composableScopes` builds its picker by walking
         * `visibleScopes` first and these now appear in it. Unordered, the
         * rounds arrived in whatever order the database returned them and the
         * compose dropdown listed Round 2 above Round 1 — caught by the test
         * that pins how a round is named.
         *
         * The same order every other screen uses: `position` for rounds, name
         * for the things a person picks by name.
         */
        // Flights only — see the same filter in `composableScopes`. These ids
        // ARE the staff flight scopes, so an unfiltered read makes a match
        // carrier a postable destination: `visibleScopes` emits its key and
        // the label builder above prints "Flight " with nothing after it.
        // Filtering the picker alone would not have been enough.
        prisma.group.findMany({
          where: { eventId, isCarrier: false },
          select: { id: true },
          orderBy: { position: "asc" },
        }),
        prisma.stage.findMany({ where: { eventId }, select: { id: true }, orderBy: { position: "asc" } }),
        prisma.team.findMany({ where: { eventId }, select: { id: true }, orderBy: { name: "asc" } }),
        // Every entry's desk ("Message the organizer"): staff read each one.
        prisma.player.findMany({ where: { eventId }, select: { id: true } }),
      ])
    : [[], [], [], []];

  return {
    whoKey: f.whoKey,
    guest: f.guest,
    muted: f.muted,
    role,
    organizationId: event.organizationId,
    orgNoun: orgProfile(event.organization.kind, event.organization.country, event.organization.communityNoun).noun,
    eventId,
    playerId,
    onRoster: f.onRoster,
    groupIds: player?.groupId ? [player.groupId] : [],
    stageIds,
    teamIds,
    matchIds: [...new Set(matchIds)],
    foursomeIds,
    staffScopes: {
      groupIds: allGroups.map((g) => g.id),
      stageIds: allStages.map((s) => s.id),
      teamIds: allTeams.map((t) => t.id),
      playerIds: allPlayers.map((p) => p.id),
    },
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
function threadIdFor(organizationId: string, eventId: string | null, key: ScopeKey): string {
  const hash = createHash("sha256").update(`${organizationId}|${eventId ?? ""}|${key}`).digest("hex");
  return `th_${hash.slice(0, 24)}`;
}

/** Club threads outlive any one tournament, so they hang off the org alone. */
function eventIdForScope(kind: ScopeKind, eventId: string): string | null {
  return kind === "club" ? null : eventId;
}

/**
 * WHAT A DESK THREAD IS CALLED, per reader (J39/J40 PR 2): the player sees the
 * people they are writing to ("The organizers"), and staff see whose desk it
 * is (the player's name). Never an address on either side.
 */
async function deskNames(ctx: MembershipContext, scopeKeys: string[]): Promise<Map<string, string>> {
  const ids = scopeKeys.map((k) => parseScopeKey(k)).filter((p) => p?.kind === "desk").map((p) => p!.id);
  if (ids.length === 0 || (ctx.role !== "admin" && ctx.role !== "assistant")) return new Map();
  const rows = await prisma.player.findMany({ where: { id: { in: ids }, eventId: ctx.eventId }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [scopeKey("desk", r.id), r.name]));
}

function titleFor(ctx: MembershipContext, kind: ScopeKind, stored: string, own: string, desks: Map<string, string>): string {
  if (kind === "desk") return desks.get(stored) || SCOPE_LABEL.desk;
  return own || scopeLabel(kind, ctx.orgNoun);
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
  const [messages, reads, desks] = await Promise.all([
    prisma.message.findMany({
      where: { threadId: { in: ids }, deletedAt: null },
      select: { threadId: true, createdAt: true, authorKey: true, body: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.threadRead.findMany({ where: { threadId: { in: ids }, whoKey: ctx.whoKey } }),
    deskNames(ctx, threads.map((t) => t.scopeKey)),
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
      // What the browser holds — never a direct conversation's stored key,
      // which is its participants' addresses. See `outwardScopeKey`.
      scopeKey: outwardScopeKey(t.scopeKey, t.id),
      kind,
      title: titleFor(ctx, kind, t.scopeKey, t.title, desks),
      label: scopeLabel(kind, ctx.orgNoun),
      lastMessageAt: t.lastMessageAt.getTime(),
      unread: unreadCount(
        msgs.map((m) => ({ createdAt: m.createdAt.getTime(), authorKey: m.authorKey })),
        ctx.whoKey,
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
  /**
   * Who wrote it, by name. The author's ADDRESS is deliberately not here: this
   * goes to every reader of the conversation, and a flight's thread would hand
   * each of its readers the address of everybody who had posted. `mine` is
   * the one thing the address was needed for.
   */
  authorName: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  mine: boolean;
  /**
   * Written through a guest's player link (S8): drawn as "Guest" beside the
   * name, so a forwarded link posting to the field is seen for what it is.
   */
  guest: boolean;
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
  const desks = await deskNames(ctx, [thread.scopeKey]);
  return {
    id: thread.id,
    scopeKey: outwardScopeKey(thread.scopeKey, thread.id),
    kind,
    title: titleFor(ctx, kind, thread.scopeKey, thread.title, desks),
    label: scopeLabel(kind, ctx.orgNoun),
    canPost: canPostToScope(ctx, thread.scopeKey),
    messages: messages.map((m) => ({
      id: m.id,
      authorName: m.authorName,
      body: m.body,
      createdAt: m.createdAt.getTime(),
      editedAt: m.editedAt?.getTime() ?? null,
      mine: m.authorKey.trim().toLowerCase() === ctx.whoKey,
      guest: isGuestKey(m.authorKey),
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
  const named = threadInOutwardKey(key);
  if (named) {
    // The id narrows; it never authorises. The conversation has to be one of
    // this person's own, by the same derived set every read is filtered on.
    const mine = await prisma.thread.findFirst({
      where: { id: named, organizationId: ctx.organizationId, scopeKey: { in: visibleScopes(ctx) } },
      select: { scopeKey: true },
    });
    if (!mine) return { ok: false, error: "You can't post there." };
    key = mine.scopeKey;
  }
  const parsed = parseScopeKey(key);
  if (!parsed) return { ok: false, error: "Unknown conversation." };
  // Said, not only refused (S8): a muted guest can still write to the organizers.
  if (ctx.muted && parsed.kind !== "desk" && canReadScope(ctx, key)) return { ok: false, error: MUTED_WORDS };
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
      createdByKey: ctx.whoKey,
      createdByName: authorName,
      lastMessageAt: now,
    },
    update: { lastMessageAt: now, archived: false },
  });

  await prisma.message.create({
    data: { threadId: id, authorKey: ctx.whoKey, authorName, body: clean.text, createdAt: now },
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
    where: { threadId_whoKey: { threadId, whoKey: ctx.whoKey } },
    create: { threadId, whoKey: ctx.whoKey, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

/**
 * Start or find a direct conversation with people picked from the address
 * book — each named by their entry in THIS tournament, which is all the
 * browser was given. Anything that is not one is refused before a thread
 * exists; the who-keys are worked out here (`whoKeysForEntry`) and never leave.
 *
 * A guest is reachable (J39/J40 PR 2): by their `guest:<playerId>` key, and by
 * their email too where an organizer gave the entry one. A member with no
 * email has no key and is refused in words. A GUEST NEVER STARTS ONE (D7): the
 * action is account-only, and this refuses a guest's context as well.
 */
export async function openDirectThreadWithPlayers(
  ctx: MembershipContext,
  playerIds: string[],
  authorName: string,
  firstMessage = "",
): Promise<PostResult> {
  if (ctx.guest) return { ok: false, error: "You can't start a conversation from a player link." };
  const wanted = [...new Set((Array.isArray(playerIds) ? playerIds : []).filter((id) => typeof id === "string" && id && id.length <= 64))];
  if (wanted.length === 0) return { ok: false, error: "Pick somebody to message." };
  if (wanted.length > 20) return { ok: false, error: "That's too many people for one conversation." };
  const players = await prisma.player.findMany({
    where: { id: { in: wanted }, eventId: ctx.eventId },
    select: { id: true, name: true, email: true, standing: true },
  });
  if (players.length !== wanted.length) {
    return { ok: false, error: "One of those people isn't in this tournament — reload and pick again." };
  }
  const keyless = players.filter((p) => whoKeysForEntry(p).length === 0);
  if (keyless.length > 0) {
    return { ok: false, error: `${keyless.map((p) => p.name).join(", ")} can't get messages here yet.` };
  }
  return openDirectThread(ctx, players.flatMap((p) => whoKeysForEntry(p)), authorName, firstMessage);
}

/**
 * NOT EXPORTED (J39/J40 PR 2): every who-key reaching it was made here, from
 * entries of the caller's own event, so none can arrive from the wire.
 * `a-who-key-never-comes-from-the-caller.test.ts` holds it there.
 */
async function openDirectThread(
  ctx: MembershipContext,
  withKeys: string[],
  authorName: string,
  firstMessage = "",
): Promise<PostResult> {
  const wanted = [...new Set(withKeys.map((e) => e.trim().toLowerCase()).filter(Boolean))].filter((e) => e !== ctx.whoKey);
  if (wanted.length === 0) return { ok: false, error: "Pick somebody to message." };
  if (wanted.length > 40) return { ok: false, error: "That's too many people for one conversation." };

  // Everyone addressed has to be in this tournament or on this club's roster: an email by address,
  // a guest key only as a GUEST entry of this very event.
  const emails = wanted.filter((k) => !isGuestKey(k));
  const guestIds = wanted.map(playerOfGuestKey).filter((id): id is string => !!id);
  const [players, members, guests] = await Promise.all([
    emails.length
      ? prisma.player.findMany({ where: { eventId: ctx.eventId, email: { in: emails, mode: "insensitive" } }, select: { email: true } })
      : [],
    emails.length
      ? prisma.member.findMany({ where: { organizationId: ctx.organizationId, email: { in: emails, mode: "insensitive" } }, select: { email: true } })
      : [],
    guestIds.length
      ? prisma.player.findMany({ where: { id: { in: guestIds }, eventId: ctx.eventId }, select: { id: true, standing: true } })
      : [],
  ]);
  const reachable = new Set([
    ...[...players, ...members].map((r) => r.email.trim().toLowerCase()).filter(Boolean),
    ...guests.filter((g) => isGuest(g)).map((g) => guestWhoKey(g.id)),
  ]);
  if (wanted.some((k) => !reachable.has(k))) {
    // Never the key itself in the words: a guest's key is an id, and the picker sends ids.
    return { ok: false, error: "One of those people isn't in this tournament — reload and pick again." };
  }

  // Anyone who has opted out of being messaged. Checked here and not only in
  // the picker, because the picker is a list in a browser and this is the
  // endpoint. Staff are not exempt: an organizer who needs to reach this
  // person has the tournament and flight threads, which the opt-out
  // deliberately does not touch.
  const optedOut = [...(await directMessagesOff(ctx, wanted)).values()];
  if (optedOut.length > 0) {
    return {
      ok: false,
      error: `${optedOut.join(", ")} ${optedOut.length === 1 ? "has" : "have"} turned off direct messages.`,
    };
  }

  const participants = [...wanted, ctx.whoKey];
  const key = scopeKey("direct", directKeyFor(participants));
  const id = threadIdFor(ctx.organizationId, ctx.eventId, key);

  await prisma.thread.upsert({
    where: { id },
    create: {
      id,
      organizationId: ctx.organizationId,
      eventId: ctx.eventId,
      scopeKey: key,
      createdByKey: ctx.whoKey,
      createdByName: authorName,
    },
    update: { archived: false },
  });

  // Participant rows are what make a direct thread visible — this is the one
  // scope whose membership is stored, because there is no structure to derive
  // it from.
  for (const whoKey of participants) {
    await prisma.threadParticipant.upsert({
      where: { threadId_whoKey: { threadId: id, whoKey } },
      create: { threadId: id, whoKey },
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
      data: { threadId: id, authorKey: ctx.whoKey, authorName, body: clean.text, createdAt: now },
    });
    await prisma.thread.update({ where: { id }, data: { lastMessageAt: now } });
    await prisma.threadRead.upsert({
      where: { threadId_whoKey: { threadId: id, whoKey: ctx.whoKey } },
      create: { threadId: id, whoKey: ctx.whoKey, lastReadAt: now },
      update: { lastReadAt: now },
    });
  }

  return { ok: true, threadId: id };
}

/**
 * WHOSE DIRECT MESSAGES ARE OFF, among these who-keys — the ONE reader over the
 * two records an identity owns (J39/J40 PR 2): an account's switch lives on its
 * club roster row (`Member.messagesOptOut`, by email), a guest's on their pass
 * (`PlayerPass.messagesOptOut`), because a guest's roster row, where there is
 * one, has no email to be found by. Each key that is off, with its owner's name
 * for the refusal. The endpoint (`openDirectThread`) and the picker
 * (`messageableField`) both ask THIS, so the picker can never list somebody the
 * endpoint refuses, or hide somebody it allows (the 2026-10-11 class).
 */
async function directMessagesOff(ctx: MembershipContext, keys: string[]): Promise<Map<string, string>> {
  const emails = [...new Set(keys.filter((k) => !isGuestKey(k)).map((k) => k.trim().toLowerCase()).filter(Boolean))];
  const guestIds = [...new Set(keys.map(playerOfGuestKey).filter((id): id is string => !!id))];
  const [members, passes] = await Promise.all([
    emails.length
      ? prisma.member.findMany({
          where: { organizationId: ctx.organizationId, email: { in: emails, mode: "insensitive" }, messagesOptOut: true },
          select: { email: true, name: true },
        })
      : [],
    guestIds.length
      ? prisma.playerPass.findMany({
          where: { playerId: { in: guestIds }, eventId: ctx.eventId, messagesOptOut: true },
          select: { playerId: true, player: { select: { name: true } } },
        })
      : [],
  ]);
  const off = new Map<string, string>();
  for (const m of members) off.set(m.email.trim().toLowerCase(), m.name);
  for (const p of passes) off.set(guestWhoKey(p.playerId), p.player.name);
  return off;
}


/**
 * Whether this person has turned off direct messages, and setting it.
 *
 * An account's preference lives on the club roster, by email — see
 * Member.messagesOptOut; somebody entered who is not on the roster has no row
 * to carry it, and defaults to reachable. A guest's lives on their pass
 * (J39/J40 PR 2), which every guest who can see the switch has.
 */
export async function messagesOptOutFor(ctx: MembershipContext): Promise<boolean> {
  if (ctx.guest) {
    const pass = await prisma.playerPass.findFirst({ where: { playerId: ctx.playerId ?? "", eventId: ctx.eventId }, select: { messagesOptOut: true } });
    return pass?.messagesOptOut ?? false;
  }
  const member = await prisma.member.findFirst({
    where: { organizationId: ctx.organizationId, email: { equals: ctx.whoKey, mode: "insensitive" } },
    select: { messagesOptOut: true },
  });
  return member?.messagesOptOut ?? false;
}

export async function setMessagesOptOut(ctx: MembershipContext, optOut: boolean): Promise<boolean> {
  // Scoped to the caller's OWN record: the pass of their own entry for a guest,
  // their own email and club for an account. There is no id parameter here at
  // all, so this cannot be pointed at anybody else.
  if (ctx.guest) {
    if (!ctx.playerId) return false;
    const res = await prisma.playerPass.updateMany({ where: { playerId: ctx.playerId, eventId: ctx.eventId }, data: { messagesOptOut: optOut === true } });
    return res.count > 0;
  }
  const res = await prisma.member.updateMany({
    where: { organizationId: ctx.organizationId, email: { equals: ctx.whoKey, mode: "insensitive" } },
    data: { messagesOptOut: optOut === true },
  });
  return res.count > 0;
}

/**
 * The address book, minus anyone who has opted out.
 *
 * Callers used to build this from the Player table directly, which meant the
 * opt-out was enforced at the endpoint but the person still appeared in the
 * dropdown — an opt-out you can see being refused is not much of one.
 *
 * GUESTS ARE IN IT (J39/J40 PR 2), by id like everyone; a member with no email
 * is not (no key reaches them). A GUEST VIEWER GETS NONE (D7): no picker is
 * drawn for a link, which starts no direct thread.
 */
export async function messageableField(
  ctx: MembershipContext,
): Promise<{ name: string; id: string }[]> {
  if (ctx.guest) return [];
  const field = await prisma.player.findMany({
    where: { eventId: ctx.eventId },
    select: { id: true, name: true, email: true, standing: true },
    orderBy: { name: "asc" },
  });
  const keyed = field.map((p) => ({ p, keys: whoKeysForEntry(p) })).filter((r) => r.keys.length > 0 && !r.keys.includes(ctx.whoKey));
  // The same reader the endpoint refuses by (PE-2): one rule for "direct messages off".
  const off = await directMessagesOff(ctx, keyed.flatMap((r) => r.keys));
  // The keys decide who is listed and then STAY HERE: what goes to the
  // browser is a name and the person's entry in this tournament. This list
  // carried `email`, and the picker used it as its value — so every player
  // was sent every other entrant's address (2026-10-11).
  return keyed.filter((r) => !r.keys.some((k) => off.has(k))).map((r) => ({ name: r.p.name, id: r.p.id }));
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
    // Flights only. A carrier is a round's match bucket with no players in it
    // ever, so offering one here put a send-to destination in the organizer's
    // picker named "Flight Match Play {em dash} Round 2" that reached nobody —
    // the round name prefixed with the word "Flight" by the label builder.
    prisma.group.findMany({
      where: { eventId: ctx.eventId, isCarrier: false },
      select: { id: true, name: true },
      // In order, because an unnamed flight is called by its position.
      orderBy: { position: "asc" },
    }),
    prisma.stage.findMany({
      where: { eventId: ctx.eventId },
      select: { id: true, type: true, description: true, position: true },
      orderBy: { position: "asc" },
    }),
    prisma.team.findMany({ where: { eventId: ctx.eventId }, select: { id: true, name: true } }),
  ]);
  // What every board calls the flight — `flightLabel`. This printed "Flight "
  // + the name, so a flight the club named "Seniors" was "Flight Seniors".
  const groupName = new Map(groups.map((g, i) => [g.id, flightLabel(g.name, i)]));
  /**
   * "Round 1 — Round Robin". Not `description`: that field holds a sentence
   * explaining the format ("Every player meets every other in their group over
   * 3 rounds"), which reads as an explanation rather than a destination when a
   * dropdown of places to send a message puts it beside "Flight A".
   *
   * This used to say it matched "how rounds are named everywhere else in the
   * app (play-auth)", and it did not — it counted every stage where other
   * screens counted rounds, so a tournament with a cut in it named the same
   * round differently here. A comment claiming two places agree is not a
   * mechanism for making them agree; `roundLabelWith` is.
   */
  const stageName = new Map(
    stages.map((s) => [s.id, roundLabelWith(stages, s.id, s.type ?? "", " — ")] as const),
  );
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  for (const key of keys) {
    const parsed = parseScopeKey(key);
    if (!parsed) continue;
    const { kind, id } = parsed;
    let label = scopeLabel(kind, ctx.orgNoun);
    if (kind === "flight") label = groupName.get(id) ?? "Flight";
    if (kind === "round") label = stageName.get(id) ?? "Round";
    if (kind === "team") label = teamName.get(id) ?? "Your team";
    if (kind === "foursome") label = `Your group — ${id.split("#")[1] ?? ""}`.trim();
    if (kind === "direct") continue; // has its own picker
    // Message the organizer: a player's own desk. Staff answer a desk inside its thread, so
    // their picker is not given one line per entry.
    if (kind === "desk") {
      if (ctx.role === "admin" || ctx.role === "assistant") continue;
      label = SCOPE_LABEL.desk;
    }
    out.push({ key, label, kind });
  }

  /**
   * Staff can broadcast to flights, rounds and teams they are not personally
   * in — that is what running a tournament is, and `staffBroadcast` has always
   * allowed it. The picker did not offer them, because it was built only from
   * the caller's own membership: an organizer who is not also playing has no
   * flight and no four, so the dropdown showed three entries and the whole
   * per-flight capability was unreachable from the UI. Found by opening the
   * screen as an organizer who isn't in the field, which is the ordinary case.
   *
   * Added after the membership-derived entries and de-duplicated, so an
   * organizer who IS in the field still sees their own flight once, and the
   * derived label wins.
   */
  if (ctx.role === "admin" || ctx.role === "assistant") {
    const seen = new Set(out.map((o) => o.key));
    const add = (kind: ScopeKind, id: string, label: string) => {
      const key = scopeKey(kind, id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, label, kind });
    };
    for (const g of groups) add("flight", g.id, groupName.get(g.id) ?? "Flight");
    for (const s of stages) add("round", s.id, stageName.get(s.id) ?? "Round");
    for (const t of teams) add("team", t.id, t.name);
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
const BROADCASTABLE: ScopeKind[] = [
  "club",
  "event",
  "players",
  "staff",
  "flight",
  "round",
  "team",
];

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
    // `stageId: null` for the same reason the two reads above filter: a match
    // carrier is not a flight, so "post to this flight" must refuse one rather
    // than open a thread nobody is in. Enforced at the CHECK as well as at the
    // pickers, because a scope key is caller-supplied — a `"use server"`
    // export is a public HTTP endpoint and will be called with whatever the
    // caller likes.
    const g = await prisma.group.findFirst({
      where: { id: parsed.id, eventId: ctx.eventId, isCarrier: false },
    });
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
      createdByKey: ctx.whoKey,
      createdByName: authorName,
      lastMessageAt: now,
    },
    update: { lastMessageAt: now, archived: false },
  });
  await prisma.message.create({
    data: { threadId: id, authorKey: ctx.whoKey, authorName, body: clean.text, createdAt: now },
  });
  return { ok: true, threadId: id };
}

/** Re-exported so callers have one import for the whole feature. */
export { canReadScope, scopeKey, SCOPE_LABEL };

/**
 * Everyone a broadcast to this scope would reach, as SMS recipients.
 *
 * Derived from the same tournament structure the in-app scopes are, so the
 * text and the message go to exactly the same people — a text reaching
 * somebody who cannot see the message it quotes would be a different bug every
 * time the two lists drifted.
 *
 * Consent and phone number are read from the club roster; a player with no
 * roster row has neither, which `planFanOut` reports as "no mobile number"
 * rather than silently dropping.
 */
export async function smsAudienceFor(
  ctx: MembershipContext,
  key: ScopeKey,
): Promise<SmsRecipient[]> {
  const parsed = parseScopeKey(key);
  if (!parsed || !canFanOutToSms(parsed.kind)) return [];

  // Who is in this scope, by the tournament's own structure.
  let players: { name: string; email: string }[] = [];
  if (parsed.kind === "club") {
    const roster = await prisma.member.findMany({
      where: { organizationId: ctx.organizationId, status: "active" },
      select: { name: true, email: true },
    });
    players = roster;
  } else if (parsed.kind === "event" || parsed.kind === "players" || parsed.kind === "round") {
    // Every round of a tournament has the whole field in it — see
    // membershipFor, where being entered is what puts a player in a round.
    players = await prisma.player.findMany({
      where: { eventId: ctx.eventId, status: "confirmed" },
      select: { name: true, email: true },
    });
  } else if (parsed.kind === "flight") {
    players = await prisma.player.findMany({
      where: { eventId: ctx.eventId, groupId: parsed.id, status: "confirmed" },
      select: { name: true, email: true },
    });
  } else if (parsed.kind === "team") {
    /**
     * Scoped to the caller's own tournament, like every branch above it.
     *
     * This was the one that selected on the id alone. A scope key is a string
     * off the wire — `team:<id>` — so an organizer of one event could ask for
     * a side in ANOTHER CLUB'S tournament and get its players back. The phone
     * numbers stayed private, because those are looked up against the
     * caller's own roster below; the NAMES came back regardless, listed in the
     * preview as "skipped — no mobile number".
     *
     * A roster of names is the thing a club is most careful with, and this
     * handed one over in a screen whose whole purpose is to look before you
     * send. `staffBroadcast` validates the same id against the same event, and
     * says so in its own comment; this is that check, on the read path.
     */
    const members = await prisma.teamMember.findMany({
      where: { teamId: parsed.id, team: { eventId: ctx.eventId } },
      select: { player: { select: { name: true, email: true } } },
    });
    players = members.map((m) => m.player).filter((p): p is { name: string; email: string } => !!p);
  }

  const emails = [...new Set(players.map((p) => p.email.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return [];

  const roster = await prisma.member.findMany({
    where: { organizationId: ctx.organizationId, email: { in: emails, mode: "insensitive" } },
    select: { email: true, phone: true, smsOptIn: true },
  });
  const byEmail = new Map(roster.map((m) => [m.email.trim().toLowerCase(), m]));

  return players.map((p) => {
    const row = byEmail.get(p.email.trim().toLowerCase());
    return {
      name: p.name,
      phone: row?.phone ?? "",
      smsOptIn: row?.smsOptIn ?? false,
    };
  });
}

export interface SmsPlan {
  /** What the text will say, exactly as it arrives. */
  text: string;
  segmentsEach: number;
  recipients: number;
  totalSegments: number;
  skipped: { name: string; reason: string }[];
  truncated: boolean;
  configured: boolean;
  problem?: string;
  /** "about $0.66", or empty when the club has set no rate. */
  costLabel: string;
}

/**
 * What texting this scope would do, without doing it.
 *
 * Shown before the send, because "this goes to 84 people as 2 segments each"
 * is the only number that changes what somebody writes — and because an
 * organizer discovering after the fact that half the field never opted in has
 * already made a decision on bad information.
 */
export async function planSmsBroadcast(
  ctx: MembershipContext,
  key: ScopeKey,
  body: string,
  clubName: string,
  rateMicros = 0,
  currencySymbol = "$",
): Promise<SmsPlan> {
  const composed = composeSms(clubName, body);
  const audience = await smsAudienceFor(ctx, key);
  const plan = planFanOut(audience, composed.text);
  const config = smsConfig();

  // Not on this plan: report it as the reason rather than as a carrier
  // problem, and say what still happens. An organizer who reads "SMS isn't
  // configured" will go looking for a setting that isn't the issue.
  if (!(await organizationAllows(ctx.organizationId, "sms"))) {
    return {
      text: composed.text,
      segmentsEach: plan.segmentsEach,
      recipients: 0,
      totalSegments: 0,
      skipped: [],
      truncated: composed.truncated,
      configured: false,
      problem: METERED_FEATURES.find((f) => f.key === "sms")!.locked,
      costLabel: "",
    };
  }

  return {
    text: composed.text,
    segmentsEach: plan.segmentsEach,
    recipients: plan.send.length,
    totalSegments: plan.totalSegments,
    skipped: plan.skipped,
    truncated: composed.truncated,
    configured: config.configured,
    problem: config.problem,
    costLabel: formatCost(estimateCost(plan.totalSegments, rateMicros), currencySymbol),
  };
}

/**
 * Post to a scope AND text everyone in it who asked to be texted.
 *
 * The in-app message is written first and unconditionally. If the carrier is
 * down, or unconfigured, or every recipient has opted out, the message still
 * reaches everybody in the app — losing the announcement because the texting
 * failed would be the worst possible trade.
 *
 * Every attempt is recorded, sent or not. SMS is the one thing here that costs
 * money per use and that somebody may later ask a consent question about, and
 * neither answer can be reconstructed from the messages themselves.
 */
export async function broadcastWithSms(
  ctx: MembershipContext,
  key: ScopeKey,
  body: string,
  authorName: string,
  clubName: string,
): Promise<PostResult & { texted: number; failed: number; skipped: number }> {
  const posted = await staffBroadcast(ctx, key, body, authorName);
  if (!posted.ok) return { ...posted, texted: 0, failed: 0, skipped: 0 };

  const parsed = parseScopeKey(key);
  if (!parsed || !canFanOutToSms(parsed.kind)) {
    return { ...posted, texted: 0, failed: 0, skipped: 0 };
  }

  // The plan gate, checked HERE rather than in the action, so that reaching
  // the endpoint directly cannot spend the club's money. The in-app message
  // above has already been written and is not affected — a club without texting
  // still reaches everybody, which is the point of the ordering.
  if (!(await organizationAllows(ctx.organizationId, "sms"))) {
    return { ...posted, texted: 0, failed: 0, skipped: 0 };
  }

  const composed = composeSms(clubName, body);
  const audience = await smsAudienceFor(ctx, key);
  const plan = planFanOut(audience, composed.text);

  // Everyone excluded is recorded too, so "why didn't Dave get it" has an
  // answer months later rather than a shrug.
  for (const s of plan.skipped) {
    await prisma.smsDelivery.create({
      data: {
        organizationId: ctx.organizationId,
        eventId: parsed.kind === "club" ? null : ctx.eventId,
        threadId: posted.threadId ?? null,
        scopeKey: key,
        toPhone: "",
        toName: s.name,
        body: composed.text,
        segments: 0,
        status: "skipped",
        error: s.reason,
        sentByEmail: ctx.whoKey,
      },
    });
  }

  let texted = 0;
  let failed = 0;
  for (const r of plan.send) {
    const to = normalizePhone(r.phone, process.env.SMS_DEFAULT_COUNTRY_CODE ?? "");
    const row = await prisma.smsDelivery.create({
      data: {
        organizationId: ctx.organizationId,
        eventId: parsed.kind === "club" ? null : ctx.eventId,
        threadId: posted.threadId ?? null,
        scopeKey: key,
        toPhone: to,
        toName: r.name,
        body: composed.text,
        segments: plan.segmentsEach,
        status: "queued",
        sentByEmail: ctx.whoKey,
      },
    });

    const res = await sendSms(to, composed.text, { organizationId: ctx.organizationId });
    await prisma.smsDelivery.update({
      where: { id: row.id },
      data: {
        status: res.ok ? "sent" : "failed",
        providerId: res.providerId ?? "",
        error: res.error ?? "",
      },
    });
    if (res.ok) texted += 1;
    else failed += 1;
  }

  return { ...posted, texted, failed, skipped: plan.skipped.length };
}

/**
 * Honour an inbound STOP or START.
 *
 * Matched on the number rather than on any id, because that is all an inbound
 * text carries. `samePhone` compares from the right so a member stored as
 * `07700 900123` is found by a reply from `+447700900123` — the same person
 * written two ways, which is the ordinary case and not an edge one.
 *
 * Returns what to reply with, or empty for nothing. STOP is honoured without a
 * confirmation question: somebody texting STOP has already decided, and asking
 * them to confirm is another text they did not want.
 */
export async function handleInboundSms(from: string, text: string): Promise<string> {
  const intent = inboundIntent(text);
  if (intent === "other") return "";

  // Every roster row that could be this number. Narrowed in code rather than
  // in SQL because numbers are stored as people typed them.
  const candidates = await prisma.member.findMany({
    where: { phone: { not: "" } },
    select: { id: true, phone: true, organization: { select: { name: true } } },
  });
  const matches = candidates.filter((m) => samePhone(m.phone, from));
  if (matches.length === 0) return "";

  if (intent === "help") {
    const club = matches[0].organization?.name ?? "your golf club";
    return `${club} tournament messages. Reply STOP to opt out.`;
  }

  const optIn = intent === "start";
  const now = new Date();
  // Applied to every club this number is on. Somebody texting STOP means stop,
  // not stop from one of the four clubs they belong to.
  await prisma.member.updateMany({
    where: { id: { in: matches.map((m) => m.id) } },
    data: optIn
      ? { smsOptIn: true, smsOptInAt: now }
      : { smsOptIn: false, smsOptOutAt: now },
  });

  return optIn
    ? "You're subscribed to tournament texts again. Reply STOP to opt out."
    : "You won't get any more texts from us. Reply START to turn them back on.";
}
