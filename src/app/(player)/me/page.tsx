import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { meFor } from "@/lib/services/me";
import { availabilityFor } from "@/lib/services/availability";
import { RoundAvailability } from "@/components/RoundAvailability";
import { todayIso } from "@/lib/deadline";
import { Icon } from "@/components/Icon";
import { roundKicker } from "@/lib/domain/round-label";
import { hasStandingToShow } from "@/lib/domain/player-standing";
import { RoundExpiryBanner } from "@/components/RoundExpiryBanner";
import { expiryNotice, hoursLeft } from "@/lib/domain/round-expiry";

/**
 * Today — the player's home.
 *
 * Three questions, in the order they are actually asked on the day: when and
 * with whom do I go off, where do I stand, and does anyone still need
 * something from me. Everything else is a tab away.
 *
 * Nothing here is computed locally. Position comes from the same standingRows
 * the board renders and the card state from the same row the approval panel
 * reads, so this screen cannot tell a player something the tournament
 * disagrees with.
 */

const CARD_STATE: Record<string, { label: string; tone: "done" | "waiting" | "problem" }> = {
  entered: { label: "Entered, not yet certified", tone: "waiting" },
  certified: { label: "Certified — with the committee", tone: "waiting" },
  approved: { label: "Approved", tone: "done" },
  disputed: { label: "Disputed", tone: "problem" },
};

export default async function PlayTodayPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const me = await meFor(state, session.email);
  const availability = await availabilityFor(state, session.email);

  const round = me.round;
  const card = round?.card ?? null;
  const cardState = card ? CARD_STATE[card.status] ?? CARD_STATE.entered : null;

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
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 26,
          lineHeight: 1.15,
          margin: "6px 0 0",
          textWrap: "balance",
        }}
      >
        {state.event.name}
      </h1>

      {/**
       * A casual round is deleted about a day after it is set up, and the whole
       * justification for that being acceptable is that the people it belongs
       * to are told before it happens.
       *
       * They were not. The banner lived only on /dashboard — which is precisely
       * the screen players are routed away from, `landingScreenFor` sending
       * every player to /me — so in an Ada-versus-Bo round the person who set
       * it up was warned and their opponent was not. The other three of a
       * fourball lost the card with no notice at all.
       *
       * The same mistake the availability card was moved here to fix, on the
       * same screen, for the same reason.
       *
       * `canKeep` is false: `keepRound` is staff-only and refuses everybody
       * else by name, so the sentence names the remedy a player actually has
       * — ask whoever set it up — rather than a button they cannot press.
       * `hoursLeft` is null for every tournament ever created, so nothing
       * mounts outside a casual round.
       */}
      <div style={{ marginTop: 14 }}>
        <RoundExpiryBanner notice={expiryNotice(hoursLeft(state.event), false)} canKeep={false} />
      </div>

      {!me.playerId && (
        <p style={{ marginTop: 16, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          You aren&rsquo;t entered in this tournament, so there&rsquo;s no card here. The board is still
          open on the next tab.
        </p>
      )}

      {/**
       * NOTHING HAS HAPPENED YET, which is the state this screen is in most
       * often — a player opens it on the way to the first tee.
       *
       * The card below is built as two halves, position on the left and score
       * on the right, and each half falls back to "Not started" on its own. So
       * before a ball is struck it rendered "Not started" twice, over two
       * em-dashes, with "0-0-0" underneath: a screen-height of the largest
       * type on the phone, saying one word, twice, and nothing else.
       *
       * Read off a launched tournament on 2026-09-09, on a 375px viewport.
       *
       * Said once now, with what a player at that moment actually wants to
       * know — that this is where it will appear. Everything they DO want is
       * already on the screen underneath: who they are playing, their tee
       * group, and their card.
       *
       * AND NOT AT ALL WHEN A MATCH CARD IS ABOUT TO SAY IT. A match round
       * prints "v <opponent> / Not started / Nothing recorded yet" directly
       * below, so this would be the third and least useful "Not started" on
       * one phone screen. The stroke case has no match card, which is the case
       * this is for.
       */}
      {me.playerId && !hasStandingToShow(me.standing) && !round?.matches.length && (
        <section className="card elev-sm" style={{ marginTop: 18 }}>
          <span className="card-kicker">Not started</span>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5 }} className="text-muted">
            Your position and score appear here as soon as the first hole goes in.
          </p>
        </section>
      )}

      {me.playerId && (
        <>
          {/* Where I stand. The one number worth the biggest type on the
              screen, and the only place this screen shouts. */}
          {hasStandingToShow(me.standing) && (
          <section
            className="card elev-sm"
            // `flexDirection: "row"` explicitly: `.card` sets column, and an
            // inline `display: flex` does not override a direction it never
            // mentions. Without it the position and the score stacked and
            // centred instead of sitting at either end of the card — which
            // looked deliberate enough that only opening the screen caught it.
            style={{ marginTop: 18, display: "flex", flexDirection: "row", alignItems: "center", gap: 18 }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                {/* Off the position itself, not off "has anyone written a
                    hole". A card that stopped short has holes and no position,
                    and labelling the dash beneath it "Position" would present
                    a place that was never awarded. */}
                {me.standing?.position ? "Position" : me.standing && me.standing.thru > 0 ? "Not ranked" : "Not started"}
              </div>
              {/* "T2", not "2", when the position is shared.
                  It showed the bare rank, which is right on a board where the
                  reader can see the rows either side of them — and wrong here,
                  where the number is addressed to ONE person. Three players
                  level on 2 were each told they were second, and that is the
                  number they quote in the bar. */}
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 40,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {me.standing?.position || "–"}
              </div>
              {/* Won–halved–lost, the same line the Board carries beside your
                  own position. A match player's record is the thing their
                  points are made of. */}
              {me.standing?.record && (
                <div style={{ fontSize: 12.5, color: "var(--color-neutral-400)", marginTop: 3 }}>
                  {me.standing.record}
                </div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                {/* What the number below actually is.
                    "Thru 4" is a fact about a stroke card, and this screen
                    printed it over a match-play round where the player's three
                    matches sit immediately underneath. The service now says
                    which — measured against what this player's own cards
                    cover, not the round's hole count, because a round robin
                    puts three matches in one round and eighteen holes returned
                    is a third of it. */}
                {me.standing?.scoreLabel ?? "Not started"}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 40,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  color:
                    me.standing && me.standing.toPar < 0
                      ? "var(--color-accent-2-300)"
                      : "var(--color-text)",
                }}
              >
                {/* The number this player is RANKED on — match points in a
                    match round, to-par in a stroke one. It printed a to-par
                    either way, so the same player's Board said "4" for four
                    match points while this said "+4" for a to-par. */}
                {me.standing?.scoreText || "–"}
              </div>
            </div>
          </section>
          )}

          {/* WHO I AM PLAYING. Above the tee group, because in a match the
              opponent is the round — and because this is the one the app
              already knew and never said.

              Read from the draw, so it is here as soon as flights are
              generated. The tee group below comes from a sheet an organizer
              has to publish, and a match-play player used to see nothing at
              all until they did. */}
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
                  // Colour only where there is something to colour. A level
                  // match is not a bad one, and painting "All square" the same
                  // grey as "Not started" would make the commonest state of a
                  // match look like an absence.
                  color: m.ahead === null ? "var(--color-text)" : m.ahead ? "var(--color-accent-2-300)" : "var(--color-text)",
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

          {/* Who I go off with. The question every player asks first, and the
              one the app was making them find on a printed sheet. */}
          {round?.group && (
            <section className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-title" style={{ fontSize: 14 }}>
                {[round.group.name || "Your group", round.group.time].filter(Boolean).join(" · ")}
              </span>
              <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.6 }}>
                {round.group.partners.length
                  ? `With ${round.group.partners.join(", ")}`
                  : "Playing on your own."}
                {round.group.startHole > 1 && (
                  <span style={{ display: "block", color: "var(--color-neutral-400)", fontSize: 13 }}>
                    Starting on hole {round.group.startHole}
                  </span>
                )}
              </p>
            </section>
          )}

          {/* What is outstanding. Stated plainly, because "why is my score not
              on the board" is otherwise a phone call to the organizer.
              Only for rounds scored on a card this player owns — offering
              "Start my card" for a match or a team round would promise a screen
              that then has to explain itself. */}
          <section className="card elev-sm" style={{ marginTop: 12 }}>
            <span className="card-title" style={{ fontSize: 14 }}>Your card</span>
            {!round?.ownCard ? (
              <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
                This round is scored by your organizer — a match is recorded against your opponent, and a
                team round on your side&rsquo;s card. It appears on the board as soon as it&rsquo;s in.
              </p>
            ) : card ? (
              <>
                <p style={{ margin: "4px 0 10px", fontSize: 14, lineHeight: 1.6 }}>
                  {card.filled} of {round?.holes} holes in.
                  <span
                    style={{
                      display: "block",
                      color:
                        cardState?.tone === "problem"
                          ? "var(--color-danger)"
                          : cardState?.tone === "done"
                            ? "var(--color-accent-2-300)"
                            : "var(--color-neutral-400)",
                    }}
                  >
                    {cardState?.label}
                  </span>
                </p>
                {card.status !== "approved" && (
                  <Link className="btn btn-primary" href="/me/card">
                    <Icon name="pencil-simple" /> Finish my card
                  </Link>
                )}
              </>
            ) : (
              <>
                <p style={{ margin: "4px 0 10px", fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
                  Nothing returned yet.
                </p>
                <Link className="btn btn-primary" href="/me/card">
                  <Icon name="pencil-simple" /> Start my card
                </Link>
              </>
            )}
          </section>

          {/* Am I playing, and when. Last because it is about weeks to come
              rather than this morning — but present at all for the first time:
              the weekly sign-up lived only on /dashboard, which is precisely
              the screen players are routed away from. */}
          {availability.playerId && (
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
        </>
      )}
    </div>
  );
}
