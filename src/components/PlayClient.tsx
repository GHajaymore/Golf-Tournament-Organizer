"use client";
import { useState, useTransition } from "react";
import { redeemRoundCode, claimPlayerSlot, leavePlay, savePlayMatchHoles, savePlayMatchResult, savePlayCard, certifyPlayCard } from "@/app/actions/play";
import { HoleByHoleCard } from "./HoleByHoleCard";
import { OrgBrand, type Brand } from "./OrgBrand";
import type { HoleResult } from "@/lib/domain";
import { Icon } from "./Icon";
import { filterNames, showsNameFilter } from "@/lib/domain/name-filter";
import { cardTotals, TOTAL_LABEL } from "@/lib/domain/card-totals";
import { computeStrokeCard, stablefordPointsForHole, modifiedStablefordForHole } from "@/lib/domain/stroke";
import { toParText } from "@/lib/domain";
import { boardKind } from "@/lib/formats";

interface PlayMatch {
  id: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aHandicap: number;
  bHandicap: number;
  holes: HoleResult[];
  /** True when the session holder is stored as player B — results must be
   *  flipped back before saving. */
  flipped: boolean;
}

interface Props {
  stage: "code" | "score" | "no-match" | "card";
  brand?: Brand | null;
  playerName?: string;
  eventName?: string;
  roundLabel?: string;
  submitWhole?: boolean;
  match?: PlayMatch;
  /**
   * How many holes THIS ROUND is played over.
   *
   * The grid used to be sized from `pars.length`, which is the card and not
   * the round. A nine-hole match handed the event's eighteen-hole card drew
   * eighteen cells, and since only nine of them can ever be filled the submit
   * button read "Fill all 18 holes to submit" and stayed disabled for good —
   * a player with a round code could not hand in their card at all. The nine
   * cells past the end were then discarded on save, so the number on screen
   * was never the number being stored either.
   */
  holes?: number;
  pars?: number[];
  yards?: number[];
  strokeIndex?: number[];
  netMode?: boolean;
  /**
   * The player's own strokes, for a round that is scored from a card rather
   * than played against somebody.
   *
   * A medal has no draw, so this surface's match-only shape sent every player
   * on a stroke-play round to "no match for you" — on a template that turns
   * player self-scoring ON and hands out a Round Code precisely so a roster of
   * names can score without accounts.
   *
   * Sent as already returned rather than opened blank, or saving would erase a
   * round somebody entered at the turn.
   */
  card?: (number | null)[];
  /**
   * That this round is temporary, in words, or "" for a tournament.
   *
   * A casual round deletes itself about a day after it is set up, and the
   * whole justification for that being acceptable is that the people it
   * belongs to are told BEFORE it happens. This surface was the last place
   * they were not.
   *
   * It became the important one the moment a casual round started issuing a
   * Round Code: before that a guest could not reach a card at all and the
   * warning on /me covered everybody who could. Now a fourball's other three
   * players score here, with no account, and they were scoring a round that
   * vanished overnight with nothing said.
   *
   * They cannot keep it — `keepRound` is staff-only and refuses everybody else
   * by name — so the sentence names the remedy they actually have, which is to
   * ask whoever set it up. Already worded by `expiryNotice`; empty renders
   * nothing.
   */
  expiryNotice?: string;
  /**
   * How this round is scored — gross | net | both | stableford.
   *
   * The card reported a gross total and a to-par figure, always, whatever the
   * round was played for. On the charity-day template that is precisely
   * backwards: it runs a STABLEFORD, and its own blurb says why — "so a bad
   * hole can't ruin anyone's round". A first-timer who takes a ten was shown
   * "+6" rather than the nought points it actually costs them, on the one
   * screen the template exists to send them to.
   *
   * `cardTotals` is the reader the console's card already uses, so the phone
   * and the desk now report the same figures for the same round.
   */
  scoringBasis?: string;
  /**
   * The round's format, because it outranks the basis where they disagree.
   *
   * A Modified Stableford round whose basis still reads "gross" — the ordinary
   * way this happens, the format changed after the basis was set — is still
   * won on points. See `ENGINE_TOTALS`.
   */
  roundFormat?: string;
  /**
   * Strokes received per hole, RESOLVED ON THE SERVER.
   *
   * Never recomputed here from a raw index. `stroke.ts` records what that
   * costs on the console's card: a net and a Stableford total three to five
   * strokes away from the dots printed beside them, and one stroke away at
   * minimum, since Stroke Play carries a 95% allowance. The same numbers the
   * board and the skins pot are settled from.
   */
  shots?: number[];
}

/**
 * The play shell, and the one thing every stage inside it has to say.
 *
 * `notice` renders here rather than in each stage so a surface added later
 * carries the warning without anybody remembering to add it — the shape this
 * codebase keeps arriving at, and the reason the /me banner had to be added by
 * hand in the first place.
 */
function Shell({
  brand,
  notice,
  children,
}: {
  brand?: Brand | null;
  /** Already-worded, from `expiryNotice`. Empty renders nothing. */
  notice?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: "22px 16px 40px",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <OrgBrand brand={brand} />
        </div>
        {notice && (
          <div
            className="card elev-sm"
            style={{
              marginBottom: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              borderColor: "var(--color-warning, var(--color-divider))",
            }}
          >
            <Icon name="clock" style={{ flex: "none" }} />
            <span style={{ fontSize: 12.5, lineHeight: 1.5, minWidth: 0, flex: 1 }}>{notice}</span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function PlayClient(props: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [players, setPlayers] = useState<Array<{ id: string; name: string }> | null>(null);
  const [context, setContext] = useState<{ eventName: string; roundLabel: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Local copy of the hole results, from the session holder's point of view.
  const [holes, setHoles] = useState<HoleResult[]>(props.match?.holes ?? []);
  const [saved, setSaved] = useState(false);
  // Two ways a finished match arrives: tapped hole by hole as it was played,
  // or phoned in from the green as "3&2". Both write the same record.
  const [entryMode, setEntryMode] = useState<"holes" | "result">("holes");
  const [resultWinner, setResultWinner] = useState<"me" | "them" | "halved">("me");
  const [resultMargin, setResultMargin] = useState("");
  // Whether this card has been signed. Held apart from `saved`, because
  // saving and signing are different statements — see the buttons.
  const [certified, setCertified] = useState(false);
  // The player's own card, for a round with no opponent in it. Sized to the
  // ROUND rather than to what arrived, so a short stored card still draws
  // every hole the round is played over.
  const [card, setCard] = useState<(number | null)[]>(() =>
    Array.from({ length: props.holes || props.pars?.length || 18 }, (_, i) => props.card?.[i] ?? null),
  );

  /* ── Step 1: enter the code ───────────────────────────────────────── */

  if (props.stage === "code") {
    const submit = () => {
      setError("");
      startTransition(async () => {
        const res = await redeemRoundCode(code);
        if (!res.ok) {
          setError(res.error ?? "That code isn't valid.");
          return;
        }
        setPlayers(res.players ?? []);
        setContext({ eventName: res.eventName ?? "", roundLabel: res.roundLabel ?? "" });
      });
    };

    // Filtered, never reordered — see name-filter.ts for why, and for the
    // threshold below.
    const shownPlayers = filterNames(players ?? [], nameFilter);

    if (players && context) {
      return (
        <Shell brand={props.brand} notice={props.expiryNotice}>
          <div style={{ marginBottom: 16 }}>
            <div className="page-kicker">{context.roundLabel}</div>
            <h1 style={{ fontSize: 24, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
              {context.eventName}
            </h1>
            <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              Tap your name to start entering your score.
            </p>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}

          {/* A WAY TO FIND YOURSELF, once the list is long enough to need one.
              ──────────────────────────────────────────────────────────────
              This is the screen a player uses standing on the first tee, one
              handed, in daylight, having just been read a code out. The field
              arrives alphabetically and nothing else — on a thirty-three
              player event that is four screens of scrolling to tap your own
              name, and an open day is worse.

              The organizer's score-entry list got a search box at a comparable
              length, and it is used by one person sitting down. This one is
              used by everybody in the field, outdoors.

              SHOWN ONLY WHERE IT HELPS. A society four-ball does not want a
              search box over four names — it would be a control that costs a
              tap and saves nothing. The threshold is about the list, not about
              any particular event.

              It filters and never reorders: a player scanning alphabetically
              for their name must not have it move while they type. */}
          {showsNameFilter(players.length) && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label htmlFor="play-name-filter">Find your name</label>
              <input
                id="play-name-filter"
                className="input"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Start typing…"
                autoComplete="off"
                // Not `type="search"`: the clear affordance a search input
                // draws is smaller than the touch minimum this screen is held
                // to, and there is a full-width list underneath doing the
                // same job.
                inputMode="text"
              />
            </div>
          )}

          <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
            {shownPlayers.length === 0 && (
              <p className="text-muted" style={{ fontSize: 13, margin: 0, padding: "13px 14px", lineHeight: 1.5 }}>
                No name matches “{nameFilter.trim()}”. Check the spelling, or clear the box to see
                everyone in the round.
              </p>
            )}
            {shownPlayers.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await claimPlayerSlot(code, p.id);
                    if (!res.ok) setError(res.error ?? "Couldn't start your session.");
                    else window.location.reload();
                  })
                }
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "13px 14px",
                  fontSize: 15,
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-divider)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                }}
              >
                {p.name}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => {
              setPlayers(null);
              setContext(null);
            }}
          >
            Use a different code
          </button>
        </Shell>
      );
    }

    return (
      <Shell brand={props.brand} notice={props.expiryNotice}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, margin: 0, fontFamily: "var(--font-heading)" }}>Enter your score</h1>
          {/* TRUE FOR BOTH KINDS OF ROUND, because this screen cannot know
              which it is: the code has not been entered yet, so there is no
              event to ask about its shape.

              It read "the round code your organizer gave you — it's on the tee
              sheet". A casual round has no organizer and no tee sheet, and
              since a quick round started issuing codes this is the screen its
              players arrive on — somebody whose mate read them eight letters
              on the first tee, being told to look for a tee sheet that does
              not exist. "Whoever set the round up" covers a club secretary and
              a mate equally, and the tee sheet is kept as the second half,
              where it is an example rather than the instruction. */}
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Type the round code you were given — whoever set the round up will have read it out, or
            it may be on the tee sheet.
          </p>
        </div>

        <div className="card elev-sm" style={{ gap: 12 }}>
          <div className="field">
            <label>Round code</label>
            <input
              className="input"
              value={code}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              style={{ fontSize: 20, letterSpacing: "0.12em", textAlign: "center" }}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>

          {error && (
            <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={pending || code.trim().length === 0}
            onClick={submit}
          >
            {pending ? "Checking…" : "Continue"}
          </button>
        </div>
      </Shell>
    );
  }

  /* ── A round scored from a card, not against an opponent ──────────── */

  if (props.stage === "card") {
    /**
     * A MEDAL, ON THE SURFACE THAT ONLY KNEW ABOUT MATCHES.
     *
     * Same grid the console's own entry screen uses — `HoleByHoleCard` is
     * presentational and calls back, so this owns the strokes and the save and
     * the two screens cannot come to draw a card differently.
     *
     * The save goes through `savePlayCard`, which writes through the same
     * `writeScorecard` the console does: one set of rules about validation,
     * partial cards, conflicts, certification and freezing a round's
     * handicaps, rather than a second copy on this side.
     */
    const holeCount = props.holes || props.pars?.length || 18;
    const filledHoles = card.filter((h) => typeof h === "number" && h > 0).length;
    const cardComplete = filledHoles === holeCount;
    const pars = props.pars ?? [];
    /**
     * The figures THIS ROUND is won on, computed the way the console does.
     *
     * `computeStrokeCard` with the server-resolved shots, and `cardTotals` to
     * decide which of its numbers to print — one reader for both, so the card
     * on the phone and the card on the desk cannot disagree about the same
     * round. Modified Stableford is scored on the Modified table, which is why
     * the format is passed rather than inferred.
     */
    const totals = computeStrokeCard(card, pars, 0, props.strokeIndex, {
      shotsPerHole: props.shots,
      pointsForHole:
        boardKind(props.roundFormat ?? "") === "modified-stableford"
          ? modifiedStablefordForHole
          : stablefordPointsForHole,
    });
    const shown = cardTotals(props.scoringBasis ?? "gross", props.roundFormat);
    const figure = (t: (typeof shown)[number]): string | number =>
      t === "gross"
        ? totals.gross || "—"
        : t === "net"
          ? totals.net || "—"
          : t === "points"
            ? totals.points
            : toParText(totals.toPar);

    const certifyCard = () => {
      setError("");
      startTransition(async () => {
        // Save first: signing a card the server has not seen would certify
        // numbers nobody stored. Same order as the console's own card.
        const wrote = await savePlayCard(card);
        if (!wrote.ok) {
          setError(wrote.error ?? "Couldn't save that card.");
          return;
        }
        setSaved(true);
        const res = await certifyPlayCard();
        if (!res.ok) {
          setError(res.error ?? "Couldn't certify that card.");
          return;
        }
        setCertified(true);
      });
    };

    const saveCard = () => {
      setError("");
      startTransition(async () => {
        const res = await savePlayCard(card);
        if (!res.ok) {
          setError(res.error ?? "Couldn't save that card.");
          return;
        }
        setSaved(true);
      });
    };

    return (
      <Shell brand={props.brand} notice={props.expiryNotice}>
        <div style={{ marginBottom: 14 }}>
          <div className="page-kicker">{props.roundLabel} · {props.eventName}</div>
          <h1 style={{ fontSize: 22, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
            {props.playerName}
          </h1>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            {/* Says which kind of round this is, because the surface used to
                claim every round was a match. */}
            Your own card — nobody to play, just your score on each hole.{" "}
            {props.submitWhole
              ? "Your organizer wants the full round submitted at the end."
              : "Saves as you go."}
          </p>
        </div>

        <div className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: "flex", gap: 14, fontSize: 13, flexWrap: "wrap" }}>
            {/* The figure the round is decided on leads, because that is the
                one being read. `cardTotals` puts points first on a Stableford
                for exactly that reason. */}
            {shown.map((t, i) => (
              <span key={t} className={i === 0 ? undefined : "text-muted"}>
                <b>{figure(t)}</b> {TOTAL_LABEL[t].toLowerCase()}
              </span>
            ))}
            <span className="text-muted" style={{ marginLeft: "auto" }}>
              {filledHoles}/{holeCount} holes
            </span>
          </div>

          <HoleByHoleCard
            players={[{ id: "me", name: props.playerName ?? "You" }]}
            cards={{ me: card }}
            pars={pars}
            yards={props.yards ?? []}
            strokeIndex={props.strokeIndex ?? []}
            holes={holeCount}
            onSet={(_id, hole, value) => {
              setCard((prev) => {
                const next = Array.from({ length: holeCount }, (_, i) => prev[i] ?? null);
                next[hole] = value;
                return next;
              });
              setSaved(false);
            }}
          />

          <button
            type="button"
            className={certified ? "btn btn-secondary" : "btn btn-primary"}
            disabled={pending || (props.submitWhole && !cardComplete)}
            onClick={saveCard}
          >
            {pending ? "Saving…" : saved ? "Saved" : props.submitWhole ? "Submit my card" : "Save"}
          </button>
          {/* A disabled button that does not say why is a dead end, and this
              one is disabled for exactly one reason. */}
          {props.submitWhole && !cardComplete && !pending && (
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Fill all {holeCount} holes to submit.
            </p>
          )}

          {/* SIGNING IT — Rule 3.3b, and the half this surface did not have.
              Without it every card a field submitted with a Round Code
              arrived at the committee reading "Not certified yet" and landed
              in "needs attention", where the only control is "Approve
              anyway": the same screen citing the rule above the button that
              overrides it. Measured on 2026-09-10.

              A separate, deliberate act, exactly as it is on the signed-in
              card. Saving is bookkeeping; certifying is a statement that
              these hole scores are right. */}
          <button
            type="button"
            className="btn btn-primary"
            // Certifying an unfinished card would be claiming holes that were
            // never played were right.
            disabled={pending || !cardComplete || certified}
            onClick={certifyCard}
            style={{ minHeight: 52 }}
          >
            <Icon name="check" /> {certified ? "Certified" : "Certify my card"}
          </button>
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            {cardComplete
              ? "Certifying says these hole scores are correct. The committee accepts it after that."
              : `Certify once all ${holeCount} holes are in.`}
          </p>
          {error && (
            <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          style={{ alignSelf: "flex-start", marginTop: 12 }}
          onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
        >
          Sign out
        </button>
      </Shell>
    );
  }

  /* ── Signed in with a code, but not playing this round ────────────── */

  if (props.stage === "no-match") {
    return (
      <Shell brand={props.brand} notice={props.expiryNotice}>
        <div className="card elev-sm">
          <span className="card-title">No match for you in {props.roundLabel}</span>
          <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            {props.playerName}, you don&rsquo;t have a match scheduled in this round of {props.eventName}.
            Check with your organizer.
          </p>
          <button
            type="button"
            className="btn"
            style={{ alignSelf: "flex-start", marginTop: 12 }}
            onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
          >
            Sign out
          </button>
        </div>
      </Shell>
    );
  }

  /* ── Step 2: the card ─────────────────────────────────────────────── */

  const m = props.match!;
  // The round's own answer first. The card's length is a fallback for a caller
  // that has not been taught to send one, and 18 the last resort — but neither
  // of those is what decides how many holes a round is.
  const holeCount = props.holes || props.pars?.length || holes.length || 18;
  const filled = holes.filter((h) => h !== null).length;
  const complete = filled === holeCount;

  const setHole = (i: number, value: HoleResult) => {
    setHoles((prev) => {
      const next = [...prev];
      while (next.length < holeCount) next.push(null);
      next[i] = next[i] === value ? null : value;
      return next;
    });
    setSaved(false);
  };

  const save = () => {
    setError("");
    startTransition(async () => {
      // Stored results are always A-relative; flip back if this player is B.
      const outgoing = m.flipped
        ? holes.map((h) => (h === "A" ? "B" : h === "B" ? "A" : h))
        : holes;
      const res = await savePlayMatchHoles(m.id, outgoing as Array<"A" | "B" | "H" | null>);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setSaved(true);
    });
  };

  const saveResult = () => {
    setError("");
    startTransition(async () => {
      // A-relative like everything stored: "me" flips when this player is B.
      const w =
        resultWinner === "halved" ? "H" : (resultWinner === "me") !== !!m.flipped ? "A" : "B";
      const res = await savePlayMatchResult(m.id, w, resultMargin);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setSaved(true);
    });
  };

  const won = holes.filter((h) => h === "A").length;
  const lost = holes.filter((h) => h === "B").length;
  const halved = holes.filter((h) => h === "H").length;

  return (
    <Shell brand={props.brand} notice={props.expiryNotice}>
      <div style={{ marginBottom: 14 }}>
        <div className="page-kicker">{props.roundLabel} · {props.eventName}</div>
        <h1 style={{ fontSize: 22, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
          {m.aName} <span className="text-muted" style={{ fontSize: 15 }}>vs</span> {m.bName}
        </h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Tap who won each hole. {props.submitWhole
            ? "Your organizer wants the full round submitted at the end."
            : "Saves as you go."}
        </p>
      </div>

      <div className="seg" style={{ marginBottom: 10 }}>
        <label className="seg-opt">
          <input type="radio" name="playmode" checked={entryMode === "holes"} onChange={() => setEntryMode("holes")} />
          Hole by hole
        </label>
        <label className="seg-opt">
          <input type="radio" name="playmode" checked={entryMode === "result"} onChange={() => setEntryMode("result")} />
          Final result
        </label>
      </div>

      {entryMode === "result" && (
        <div className="card elev-sm" style={{ gap: 12 }}>
          <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
            The finished match, straight from the green. This replaces anything tapped hole by hole.
          </p>
          <div className="seg" style={{ width: "100%" }}>
            {(["me", "halved", "them"] as const).map((w) => (
              <label key={w} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="playwinner" checked={resultWinner === w} onChange={() => setResultWinner(w)} />
                {w === "me" ? "I won" : w === "halved" ? "Halved" : "They won"}
              </label>
            ))}
          </div>
          {resultWinner !== "halved" && (
            <div className="field">
              <label>By how much</label>
              <input
                className="input"
                value={resultMargin}
                onChange={(e) => setResultMargin(e.target.value)}
                placeholder={'e.g. "3&2", "2 UP", "1 UP"'}
                inputMode="text"
              />
            </div>
          )}
          <button type="button" className="btn btn-primary" disabled={pending} onClick={saveResult}>
            {pending ? "Saving…" : saved ? "Saved" : "Submit result"}
          </button>
          {error && (
            <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}
        </div>
      )}

      {entryMode === "holes" && (
      <div className="card elev-sm" style={{ gap: 10 }}>
        <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
          <span><b>{won}</b> won</span>
          <span><b>{halved}</b> halved</span>
          <span><b>{lost}</b> lost</span>
          <span className="text-muted" style={{ marginLeft: "auto" }}>{filled}/{holeCount} holes</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {Array.from({ length: holeCount }, (_, i) => {
            const v = holes[i] ?? null;
            return (
              <div
                key={i}
                style={{
                  border: "1px solid var(--color-divider)",
                  borderRadius: "var(--radius-md)",
                  padding: "6px 6px 7px",
                }}
              >
                <div className="text-muted" style={{ fontSize: 10, marginBottom: 4, textAlign: "center" }}>
                  {i + 1}
                  {props.pars?.[i] ? ` · par ${props.pars[i]}` : ""}
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  {(["A", "H", "B"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      disabled={pending}
                      onClick={() => setHole(i, opt)}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 5,
                        cursor: "pointer",
                        border: "1px solid var(--color-divider)",
                        background:
                          v === opt ? "var(--color-accent)" : "transparent",
                        color: v === opt ? "var(--color-accent-100, #fff)" : "var(--color-text)",
                      }}
                    >
                      {opt === "A" ? "Me" : opt === "H" ? "½" : "Opp"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
            <Icon name="warning-circle" /> {error}
          </p>
        )}

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending || (props.submitWhole && !complete)}
          onClick={save}
        >
          {pending
            ? "Saving…"
            : saved
              ? "Saved — your organizer will review it"
              : props.submitWhole
                ? complete
                  ? "Submit my card"
                  : `Fill all ${holeCount} holes to submit`
                : "Save"}
        </button>
      </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <span className="text-muted" style={{ fontSize: 12 }}>Playing as {props.playerName}</span>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px" }}
          onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
        >
          Sign out
        </button>
      </div>
    </Shell>
  );
}
