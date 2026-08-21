import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { meFor } from "@/lib/services/me";
import { availabilityFor } from "@/lib/services/availability";
import { RoundAvailability } from "@/components/RoundAvailability";
import { todayIso } from "@/lib/deadline";
import { toParText } from "@/lib/domain";

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
        {[round?.label ?? "Today", round?.venue].filter(Boolean).join(" · ")}
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

      {!me.playerId && (
        <p style={{ marginTop: 16, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          You aren&rsquo;t entered in this tournament, so there&rsquo;s no card here. The board is still
          open on the next tab.
        </p>
      )}

      {me.playerId && (
        <>
          {/* Where I stand. The one number worth the biggest type on the
              screen, and the only place this screen shouts. */}
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
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                {me.standing && me.standing.thru >= (round?.holes ?? 18) ? "Final" : `Thru ${me.standing?.thru ?? 0}`}
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
                {me.standing && me.standing.thru > 0 ? toParText(me.standing.toPar) : "–"}
              </div>
            </div>
          </section>

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
                    <i className="ph ph-pencil-simple" /> Finish my card
                  </Link>
                )}
              </>
            ) : (
              <>
                <p style={{ margin: "4px 0 10px", fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
                  Nothing returned yet.
                </p>
                <Link className="btn btn-primary" href="/me/card">
                  <i className="ph ph-pencil-simple" /> Start my card
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
                today={todayIso()}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
