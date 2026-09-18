import { screenName } from "@/lib/nav";
import Link from "next/link";
import { redirect } from "next/navigation";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { allowsAutoConfirm } from "@/lib/tournament-settings";
import { cardStanding } from "@/lib/domain/card-approval";
import { announcementsFor } from "@/lib/services/announcements";
import { AnnouncementList } from "@/components/AnnouncementList";
import { meFor } from "@/lib/services/me";
import { availabilityFor } from "@/lib/services/availability";
import { RoundAvailability } from "@/components/RoundAvailability";
import { todayIso } from "@/lib/deadline";
import { Icon } from "@/components/Icon";
import { roundKicker } from "@/lib/domain/round-label";
import { hasStandingToShow } from "@/lib/domain/player-standing";
import { RoundExpiryBanner } from "@/components/RoundExpiryBanner";
import { expiryNotice, hoursLeft } from "@/lib/domain/round-expiry";
import { nextHoleToPlay } from "@/lib/domain/next-hole";

/**
 * Today — the player's home.
 *
 * THE ROUND FIRST (design "A", chosen by the club 2026-09-18). The screen a
 * player keeps open on the course leads with the thing they open it to do:
 * where their round has got to, and one large button to carry on. Position,
 * group and notices follow as short rows; the week-by-week availability
 * calendar underneath is unchanged, on purpose — it was the part of the old
 * screen people liked.
 *
 * Nothing here is computed locally. Position comes from the same standingRows
 * the board renders and the card state from the same row the approval panel
 * reads, so this screen cannot tell a player something the tournament
 * disagrees with.
 */

/**
 * The one screen outside the console that never named itself either.
 *
 * `/me` is where `landingScreenFor("player")` sends everybody who plays, so
 * this is the tab a player keeps open on the course — and it read the
 * marketing sentence, the same as the organizer's twenty-one.
 */
export const metadata = screenMetadata("/me");

/** A tinted row that opens another screen — the tournaments list, a casual round. */
const ROW: React.CSSProperties = {
  minHeight: 56,
  borderRadius: 16,
  padding: "10px 16px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  textDecoration: "none",
  color: "var(--color-text)",
  background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
};
const ROW_ICON: React.CSSProperties = { color: "var(--color-accent-300)", display: "grid", placeItems: "center" };
const ROW_TEXT: React.CSSProperties = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 };

/** Up to two letters for a name, for the little group avatars. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export default async function PlayTodayPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const me = await meFor(state, session.email);
  const availability = await availabilityFor(state, session.email);
  const announcements = await announcementsFor(session.eventId);

  const round = me.round;
  const card = round?.card ?? null;
  /**
   * Whether a committee is going to look at this card, from the round's own
   * setting. `cardStanding` carries the whole reason; the short version is
   * that a card stops at "certified" when nobody approves cards, and this
   * screen was calling that state unfinished, in grey, forever.
   */
  const cardState = cardStanding(card?.status ?? "entered", !allowsAutoConfirm(settingsOf(state.event)));
  const standing = hasStandingToShow(me.standing) ? me.standing : null;

  /**
   * THE HERO IS FOR A ROUND THE PLAYER SCORES THEMSELVES.
   *
   * "9 of 18 holes in" and a button to carry on are true only of a card this
   * player owns. A match is recorded against the opponent and a team round
   * on the side's card, so those rounds keep the cards they had — a hero
   * promising a card `/me/card` would then refuse is the contradiction
   * `MyRound.ownCard` exists to prevent.
   */
  const hero = Boolean(me.playerId && round?.ownCard);
  const holes = round?.holes ?? 0;
  const strokes: (number | null)[] = card?.strokes ?? Array.from({ length: holes }, () => null);
  const next = card ? nextHoleToPlay(strokes, round?.group?.startHole ?? 1) : 1;

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--color-neutral-400)",
        }}
      >
        {/* Same label slot, same rule as the Board's — `label` prefers the
            organizer's description, and a description may be a whole
            sentence. `name` is the short one ("Round 1"), already resolved by
            the service for exactly this reason. */}
        {[round ? roundKicker(round.label, round.name) : "Today", round?.venue].filter(Boolean).join(" · ")}
      </div>
      {/* Smaller than it was, and held to two lines. A championship's full
          name ran to three lines at phone width and pushed the player's own
          round below the fold; the name is still all here for anyone who
          wants it, on the Board and in the header above. */}
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 21,
          lineHeight: 1.2,
          margin: "4px 0 0",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {state.event.name}
      </h1>

      {/**
       * A casual round is deleted about a day after it is set up, and the whole
       * justification for that being acceptable is that the people it belongs
       * to are told before it happens. `canKeep` is false: `keepRound` is
       * staff-only, so the sentence names the remedy a player actually has.
       * `hoursLeft` is null for every tournament, so nothing mounts outside a
       * casual round.
       */}
      <div style={{ marginTop: 12 }}>
        <RoundExpiryBanner notice={expiryNotice(hoursLeft(state.event), false)} canKeep={false} />
      </div>

      {/**
       * PINNED NOTICES STAY ABOVE THE ROUND. `/announcements` promises the
       * organizer that "Pinned posts sit at the top of every player's
       * dashboard", and pinning is the organizer saying this one outranks
       * everything — a frost delay. Unpinned posts sit under the round.
       */}
      <AnnouncementList items={announcements.filter((a) => a.pinned)} />

      {!me.playerId && (
        <p style={{ marginTop: 16, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          You aren&rsquo;t entered in this tournament, so there&rsquo;s no card here. The board is still
          open on the next tab.
        </p>
      )}

      {hero && (
        <section
          aria-label="Your round"
          style={{
            marginTop: 14,
            borderRadius: 22,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            // The filled accent with the label colour solved to read on it —
            // `--color-on-accent` clears 4.5:1 against step 500 for every
            // palette a club can pick (accent-is-not-a-text-colour.test.ts).
            background: "var(--color-accent)",
            color: "var(--color-on-accent)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {standing ? "Your round" : "Not started"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 38,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {/* "Thru 9", "Final" — the service's own label for where this
                    card has got to, measured against the holes it owes. */}
                {standing?.scoreLabel ?? (card ? `${card.filled} in` : "Tee off")}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Score
              </span>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 38,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {/* The number this player is RANKED on — to-par in a stroke
                    round, points in a Stableford one. */}
                {standing?.scoreText || "–"}
              </span>
            </div>
          </div>

          {holes > 0 && (
            <div
              role="img"
              aria-label={`${card?.filled ?? 0} of ${holes} holes in`}
              // FLEX, NOT GRID. An inline `grid-template-columns` is collapsed to
              // one column inside <main> at phone width — the availability
              // calendar hit the same rule and moved to the `.cal-week` class —
              // and this strip rendered as eighteen stacked bars on first look.
              style={{ display: "flex", gap: 3 }}
            >
              {strokes.map((s, i) => (
                <span
                  key={i}
                  style={{
                    flex: "1 1 0",
                    minWidth: 0,
                    height: 8,
                    borderRadius: 3,
                    background:
                      s !== null && s !== undefined
                        ? "var(--color-on-accent)"
                        : "color-mix(in srgb, var(--color-on-accent) 25%, transparent)",
                  }}
                />
              ))}
            </div>
          )}

          {/* ONE BUTTON, and its words come from the same place as the line
              under it — "Finish my card" over a signed, complete card was the
              loudest half of an untruth. The hole number is added, never
              substituted, so the action keeps its own name. */}
          {(!card || cardState.action) && (
            <Link
              href="/me/card"
              style={{
                minHeight: 58,
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                textDecoration: "none",
                background: "var(--color-on-accent)",
                color: "var(--color-accent)",
                fontFamily: "var(--font-heading)",
                fontSize: 19,
                fontWeight: 600,
              }}
            >
              <Icon name={!card || cardState.action === "Finish my card" ? "pencil-simple" : "eye"} />
              {!card ? "Start my card" : cardState.action}
              {card && cardState.action === "Finish my card" && next !== null && (
                <span style={{ fontFamily: "var(--font-body)", fontSize: 13.5, fontWeight: 500 }}>
                  · hole {next} next
                </span>
              )}
            </Link>
          )}

          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {card ? (
              <>
                {card.filled} of {holes} holes in · {cardState.label}
              </>
            ) : (
              "Nothing returned yet."
            )}
          </div>
        </section>
      )}

      {/* A player whose round is scored for them — a match or a team round —
          keeps the cards this screen always had. */}
      {me.playerId && !hero && (
        <>
          {!standing && !round?.matches.length && (
            <section className="card elev-sm" style={{ marginTop: 18 }}>
              <span className="card-kicker">Not started</span>
              <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5 }} className="text-muted">
                Your position and score appear here as soon as the first hole goes in.
              </p>
            </section>
          )}
          {standing && (
            <section
              className="card elev-sm"
              style={{ marginTop: 18, display: "flex", flexDirection: "row", alignItems: "center", gap: 18 }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                  {standing.position ? "Position" : standing.thru > 0 ? "Not ranked" : "Not started"}
                </div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {standing.position || "–"}
                </div>
                {standing.record && (
                  <div style={{ fontSize: 12.5, color: "var(--color-neutral-400)", marginTop: 3 }}>{standing.record}</div>
                )}
                {standing.note && (
                  <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", marginTop: 5, lineHeight: 1.5 }}>
                    {standing.note}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                  {standing.scoreLabel ?? "Not started"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 40,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                    color: standing.toPar < 0 ? "var(--color-accent-2-300)" : "var(--color-text)",
                  }}
                >
                  {standing.scoreText || "–"}
                </div>
              </div>
            </section>
          )}
          {round?.matches.map((m, i) => (
            <section key={i} className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-title" style={{ fontSize: 14 }}>
                {round.matches.length > 1 ? `Match ${i + 1} — ` : ""}v {m.opponent}
              </span>
              <p
                style={{
                  margin: "4px 0 0",
                  fontFamily: "var(--font-heading)",
                  fontSize: 22,
                  lineHeight: 1.2,
                  color: m.ahead ? "var(--color-accent-2-300)" : "var(--color-text)",
                }}
              >
                {m.state}
              </p>
              {m.notStarted && (
                <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                  Nothing recorded yet — it appears here hole by hole as it goes in.
                </p>
              )}
            </section>
          ))}
          <section className="card elev-sm" style={{ marginTop: 12 }}>
            <span className="card-title" style={{ fontSize: 14 }}>Your card</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
              This round is scored by your organizer — a match is recorded against your opponent, and a
              team round on your side&rsquo;s card. It appears on the board as soon as it&rsquo;s in.
            </p>
          </section>
        </>
      )}

      {/* WHERE I STAND, as one row that opens the board. The hero above
          already carries the score, so this says the place — and whether it
          can still move — without repeating the number. */}
      {hero && standing && (
        <Link
          href="/me/board"
          className="card elev-sm"
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            textDecoration: "none",
            color: "var(--color-text)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 30,
              lineHeight: 1,
              minWidth: 48,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {standing.position || "–"}
          </span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {standing.position ? "On the board" : standing.thru > 0 ? "Not ranked yet" : "Not started"}
            </span>
            {(standing.note || standing.record) && (
              <span className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                {standing.note || standing.record}
              </span>
            )}
          </span>
          <Icon name="arrow-right" />
        </Link>
      )}

      {/* Who I go off with. The question every player asks first. */}
      {me.playerId && round?.group && (
        <section
          className="card elev-sm"
          style={{ marginTop: 12, display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          {round.group.partners.length > 0 && (
            <span aria-hidden="true" style={{ display: "flex", flex: "none" }}>
              {round.group.partners.slice(0, 3).map((p, i) => (
                <span
                  key={i}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "var(--color-surface-2)",
                    border: "2px solid var(--color-surface)",
                    marginLeft: i === 0 ? 0 : -8,
                  }}
                >
                  {initialsOf(p)}
                </span>
              ))}
            </span>
          )}
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {[round.group.name || "Your group", round.group.time].filter(Boolean).join(" · ")}
            </span>
            <span className="text-muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
              {round.group.partners.length ? `With ${round.group.partners.join(", ")}` : "Playing on your own."}
              {round.group.startHole > 1 ? ` · starting on hole ${round.group.startHole}` : ""}
            </span>
          </span>
        </section>
      )}

      {/* The rest of what the club posted, under the player's own round. */}
      {announcements.some((a) => !a.pinned) && (
        <div style={{ marginTop: 12 }}>
          <AnnouncementList items={announcements.filter((a) => !a.pinned)} />
        </div>
      )}

      {/* WHAT ELSE THE CLUB HAS ON, and a round of your own. The club's
          tournaments — where a member enters one — and the free-tier casual
          round, which is for anybody, not only organizers. Deliberately not
          tabs: see PLAYER_EVENTS in player-nav.ts. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        <Link href="/me/events" style={ROW}>
          <span style={ROW_ICON}>
            <Icon name="calendar-dots" />
          </span>
          <span style={ROW_TEXT}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{screenName("/me/events")}</span>
            <span className="text-muted" style={{ fontSize: 12.5 }}>Everything your club is running, and entering</span>
          </span>
          <Icon name="arrow-right" />
        </Link>
        <Link href="/match/new" style={ROW}>
          <span style={ROW_ICON}>
            <Icon name="sword" />
          </span>
          <span style={ROW_TEXT}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Play a casual round</span>
            <span className="text-muted" style={{ fontSize: 12.5 }}>Just you and your group — no tournament needed</span>
          </span>
          <Icon name="arrow-right" />
        </Link>
      </div>

      {/* Am I playing, and when — the calendar, unchanged. */}
      {me.playerId && availability.playerId && (
        <div style={{ marginTop: 12 }}>
          <RoundAvailability
            playerId={availability.playerId}
            next={availability.next}
            future={availability.future}
            past={availability.past}
            captainOf={availability.captainOf}
            asksPlayer={availability.asksPlayer}
            today={todayIso()}
          />
        </div>
      )}
    </div>
  );
}
