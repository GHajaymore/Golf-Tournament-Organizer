/**
 * Who can read which conversation.
 *
 * This is the security core of messaging, kept pure so it can be tested
 * without a database and reasoned about without reading a query.
 *
 * The shape matters more than any individual rule. Every other id-taking
 * action in this app has the same weakness: the caller hands over a row id and
 * something has to prove they own it (see audit-idor.test.ts, and the four
 * findings that got through anyway). Messaging never asks that question.
 * Instead `visibleScopes` derives, from the tournament's own structure, the
 * complete set of conversations a person may see — and every read is filtered
 * to that set. A thread id off the wire is not a permission check that can be
 * forgotten; it is a value that either appears in a derived list or does not.
 *
 * The second reason to derive rather than store: membership changes. A player
 * moves flight, a tee sheet is republished, a side is redrawn. A stored
 * recipient list goes stale exactly the way a published tee sheet does (D12 of
 * the 2026-08-12 audit) and would keep showing a conversation to somebody who
 * has left it. Derived membership cannot drift, because there is nothing to
 * drift from.
 */

/** Scope kinds, widest to narrowest. */
export type ScopeKind =
  /** Everyone on the club roster, across tournaments. */
  | "club"
  /** Everyone in one tournament. */
  | "event"
  /** Organizers and assistants of one tournament. Never visible to players. */
  | "staff"
  /** One flight. */
  | "flight"
  /** Everyone playing one round. */
  | "round"
  /** One side in a team format. */
  | "team"
  /** One tee-sheet group — the four people walking together. */
  | "foursome"
  /** The two sides of one match. */
  | "match"
  /** An explicit conversation between named people. */
  | "direct";

export const SCOPE_KINDS: ScopeKind[] = [
  "club",
  "event",
  "staff",
  "flight",
  "round",
  "team",
  "foursome",
  "match",
  "direct",
];

/**
 * A scope as it is stored and compared: `kind:id`.
 *
 * One string rather than two columns because every read is `scopeKey IN
 * (derived list)`, and a single indexed column makes that the whole query.
 * Club, event and staff threads have no id of their own — the event or
 * organization the thread hangs off already says which one.
 */
export type ScopeKey = string;

export function scopeKey(kind: ScopeKind, id = ""): ScopeKey {
  return `${kind}:${id}`;
}

export function parseScopeKey(key: ScopeKey): { kind: ScopeKind; id: string } | null {
  const at = key.indexOf(":");
  if (at < 0) return null;
  const kind = key.slice(0, at) as ScopeKind;
  if (!SCOPE_KINDS.includes(kind)) return null;
  return { kind, id: key.slice(at + 1) };
}

/**
 * Everything the tournament knows about where one person sits in it.
 *
 * Assembled by the service layer from rows it has already scoped. Nothing here
 * comes from the caller — that is the point.
 */
export interface MembershipContext {
  /** Lower-cased. Email is identity throughout this app. */
  email: string;
  role: "admin" | "assistant" | "player";
  organizationId: string;
  eventId: string;
  /** This person's Player id in this event, if they are in the field. */
  playerId: string | null;
  /** Whether they are on the club roster at all. */
  onRoster: boolean;
  groupIds: string[];
  /** Rounds they are actually in — not every round of the tournament. */
  stageIds: string[];
  teamIds: string[];
  matchIds: string[];
  /** Tee-sheet groups, keyed `${stageId}#${groupName}` — see teeGroupId. */
  foursomeIds: string[];
  /** Direct threads they are a named participant of. */
  directThreadIds: string[];
}

/**
 * A tee-sheet group has no id of its own — it is a name inside a round's
 * stored sheet. Qualifying it with the round keeps "Group 3" of Saturday
 * distinct from "Group 3" of Sunday, which would otherwise be one conversation
 * shared by two different fours.
 */
export function teeGroupId(stageId: string, groupName: string): string {
  return `${stageId}#${groupName}`;
}

/**
 * Every scope this person may READ, as scope keys.
 *
 * Deriving the allowed set — rather than checking an id they supplied — is
 * what makes this safe by construction. There is no path where forgetting a
 * check widens access, because access is only ever the return value of this
 * function.
 */
export function visibleScopes(ctx: MembershipContext): ScopeKey[] {
  const keys: ScopeKey[] = [];

  // Club-wide reaches people who are on the roster but not in this
  // tournament — which is most of a club most of the time, and the whole
  // reason a club-level conversation is different from an event-level one.
  if (ctx.onRoster || ctx.role !== "player") keys.push(scopeKey("club"));

  // Being in the field is what admits someone to the tournament's own
  // conversations. Staff are admitted because they run it.
  const inEvent = ctx.playerId !== null || ctx.role !== "player";
  if (inEvent) keys.push(scopeKey("event"));

  // The one scope a player may never read, however they got here. An
  // organizer previewing as a player must not see it either: preview exists to
  // show what a player sees, and a back-room conversation is the clearest case
  // of something they do not.
  if (ctx.role === "admin" || ctx.role === "assistant") keys.push(scopeKey("staff"));

  for (const id of ctx.groupIds) keys.push(scopeKey("flight", id));
  for (const id of ctx.stageIds) keys.push(scopeKey("round", id));
  for (const id of ctx.teamIds) keys.push(scopeKey("team", id));
  for (const id of ctx.foursomeIds) keys.push(scopeKey("foursome", id));
  for (const id of ctx.matchIds) keys.push(scopeKey("match", id));
  for (const id of ctx.directThreadIds) keys.push(scopeKey("direct", id));

  return keys;
}

/**
 * Whether a person may read one specific scope.
 *
 * Defined in terms of `visibleScopes` rather than beside it, so the two can
 * never disagree — a second implementation of the same rule is how these
 * things drift apart.
 */
export function canReadScope(ctx: MembershipContext, key: ScopeKey): boolean {
  return visibleScopes(ctx).includes(key);
}

/**
 * Whether a person may POST to a scope they can read.
 *
 * Reading and writing differ in exactly two places, both of them
 * announcements rather than conversations: club-wide and event-wide threads
 * are how an organizer reaches everybody, and a field of 120 people all able
 * to reply to all of them is not a feature, it is a broadcast storm. Every
 * narrower scope — your flight, your four, your match, your side — is a real
 * conversation and everybody in it may talk.
 */
export function canPostToScope(ctx: MembershipContext, key: ScopeKey): boolean {
  if (!canReadScope(ctx, key)) return false;
  const parsed = parseScopeKey(key);
  if (!parsed) return false;
  if (parsed.kind === "club" || parsed.kind === "event") {
    return ctx.role === "admin" || ctx.role === "assistant";
  }
  return true;
}

/**
 * Whether a person may START a thread in a scope.
 *
 * Same rule as posting. Kept as its own name because the two are asked in
 * different places and reading `canPostToScope` at a "new conversation" button
 * would invite someone to "fix" one without the other.
 */
export function canStartThreadIn(ctx: MembershipContext, key: ScopeKey): boolean {
  return canPostToScope(ctx, key);
}

/** Human label for a scope kind, for headers and pickers. */
export const SCOPE_LABEL: Record<ScopeKind, string> = {
  club: "Everyone at the club",
  event: "Everyone in this tournament",
  staff: "Organizers only",
  flight: "Your flight",
  round: "Everyone in this round",
  team: "Your team",
  foursome: "Your group",
  match: "Your match",
  direct: "Direct message",
};

/**
 * Ordering for a thread list: most recently active first, but anything the
 * reader has not seen floats above what they have.
 *
 * Unread-first because the list is read on a phone between shots, where the
 * useful question is "is there anything I need to know", not "what is newest".
 */
export interface ThreadSummary {
  id: string;
  scopeKey: ScopeKey;
  title: string;
  lastMessageAt: number;
  unread: number;
}

export function sortThreads(threads: ThreadSummary[]): ThreadSummary[] {
  return [...threads].sort((a, b) => {
    const unreadA = a.unread > 0 ? 1 : 0;
    const unreadB = b.unread > 0 ? 1 : 0;
    if (unreadA !== unreadB) return unreadB - unreadA;
    if (b.lastMessageAt !== a.lastMessageAt) return b.lastMessageAt - a.lastMessageAt;
    // A stable last resort, so two threads saved in the same millisecond do
    // not swap places between renders.
    return a.id.localeCompare(b.id);
  });
}

/** Longest message we will store. Long enough for a real note, short enough
 *  that a paste accident is not a database problem. */
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_TITLE_LENGTH = 120;

export interface CleanMessage {
  ok: boolean;
  text: string;
  error?: string;
}

/**
 * Validate and normalise a message body.
 *
 * Whitespace-only is rejected rather than stored: an empty bubble in a thread
 * is noise everybody else has to scroll past, and it is what a stray Enter
 * produces.
 */
export function cleanMessageBody(raw: string): CleanMessage {
  // Normalise line endings first so the length check counts what a person
  // typed rather than how their browser encoded it.
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return { ok: false, text: "", error: "Type a message first." };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, text: "", error: `Keep it under ${MAX_MESSAGE_LENGTH} characters.` };
  }
  return { ok: true, text };
}

/**
 * Count of messages this reader has not seen.
 *
 * A watermark rather than a per-message read row: one row per person per
 * thread instead of one per person per message, and the answer to "what is
 * new" is a timestamp comparison. Their own messages never count as unread —
 * posting is seeing.
 */
export function unreadCount(
  messages: { createdAt: number; authorEmail: string }[],
  readerEmail: string,
  lastReadAt: number | null,
): number {
  const me = readerEmail.trim().toLowerCase();
  return messages.filter(
    (m) => m.authorEmail.trim().toLowerCase() !== me && m.createdAt > (lastReadAt ?? 0),
  ).length;
}

/**
 * The scope key for a direct conversation between a set of people.
 *
 * Sorted and joined so that the same people always produce the same key
 * whoever opens it first — otherwise "Rita messages Sam" and "Sam messages
 * Rita" become two threads that each show half the conversation.
 */
export function directKeyFor(emails: string[]): string {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  return unique.sort().join("|");
}
