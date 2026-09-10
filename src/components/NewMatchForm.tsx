"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMatch } from "@/app/actions/match-setup";
import { CoursePicker, type CourseOption } from "@/components/CoursePicker";
import {
  planMatch,
  exactPlayersFor,
  headToHeadPhrase,
  QUICK_ROUND_FORMATS,
  QUICK_ROUND_MAX_PLAYERS,
  QUICK_MONEY_GAMES,
  STAKE_NOTE_MAX,
} from "@/lib/domain/quick-match";
import { entryModesFor } from "@/lib/domain/match-entry";
import { Icon } from "./Icon";

/**
 * Setting up one casual round, in one screen.
 *
 * The order of the questions is the design, and it changed when the screen
 * stopped making only matches. WHAT you are playing now comes before WHO is
 * playing, which reverses the original reasoning ("who is playing comes first
 * because it is the only thing the two of them definitely know"). That was
 * right while there was one format; it is wrong now, because the format
 * decides how many names the screen will take. Asking it second means typing
 * four names and then being told the game you picked is played by two.
 *
 * What is NOT asked is as deliberate as what is. No email, no mobile, no
 * handicap source, no tournament shape, no template, no flights, no tee sheet,
 * and no second round: those are questions a club running a championship has
 * answers to, and a question with no answer is where somebody stops.
 *
 * THE RULES ARE NOT RESTATED HERE. The screen calls `planMatch` — the same
 * pure function the server action calls — on every keystroke and shows what it
 * refuses. So the button is disabled exactly when the action would refuse, and
 * for the same stated reason, without this file holding a second opinion about
 * how many people play match play.
 */
export interface RosterMember {
  id: string;
  name: string;
  /** As it would be typed — "+2" for a plus-handicap, never "-2". */
  handicap: string;
}

/** One entered player: a member if `memberId` is set, otherwise a guest. */
interface Entrant {
  name: string;
  hcp: string;
  /** The roster row this is, or "" for a guest who is not in the club. */
  memberId: string;
}

export function NewMatchForm({
  courses,
  myName,
  members = [],
  me = null,
}: {
  /**
    * The club's own courses.
    *
    * Empty for somebody who has never set one up, which is the common case
    * here — the picker used to be hidden when it was, and is not any more:
    * the course is required, so hiding it would be a wall rather than a
    * question. The directory search behind it is what makes an empty library
    * workable.
    */
  courses: CourseOption[];
  /** Prefilled as the first player: whoever is setting this up is almost
   *  always in it, and correcting a name is quicker than typing one. */
  myName: string;
  /**
   * The club's roster, for picking rather than typing.
   *
   * Optional and defaulting to empty, so somebody who has never run anything
   * gets the plain name fields they had — the suggestions appear when there is
   * a club behind them, and nothing changes when there is not.
   */
  members?: RosterMember[];
  /**
   * The organizer's own roster row, when the club has one for them.
   *
   * The first row is prefilled with whoever is setting the round up, and it
   * was a guest like any other — so somebody in their own club's roster for
   * years read "guest, not added to your roster" on their own screen and had
   * to type an index the club already knows. Null keeps exactly the behaviour
   * that was there.
   */
  me?: RosterMember | null;
}) {
  const router = useRouter();
  /**
   * NOTHING PRESELECTED. The round type is a question, not a default.
   *
   * Match Play was preselected, so the commonest path through this screen
   * never asked what people were playing — and the round type decides the
   * stage type, the event format and whether a fixture is drawn at all.
   */
  const [format, setFormat] = useState("");
  const [players, setPlayers] = useState<Entrant[]>([
    // Row one is whoever is setting this up, as a member where the club knows
    // them — name, index and all — and as a plain name where it does not.
    me
      ? { name: me.name, hcp: me.handicap, memberId: me.id }
      : { name: myName, hcp: "", memberId: "" },
    { name: "", hcp: "", memberId: "" },
  ]);
  /** Which row's suggestion list is open. -1 for none. */
  const [openRow, setOpenRow] = useState(-1);
  /**
   * The pending "close the list" timer, so re-opening cancels it.
   *
   * Closing on blur has to be DELAYED, because clicking a suggestion blurs the
   * input before the click lands — close immediately and the button is gone
   * before it can be pressed. But a bare delayed close is a race: focus the
   * field, blur it, focus it again inside the delay, and the old timer fires
   * against the new state and shuts a list the player has just opened. Guarding
   * on the row index does not help, because it is usually the same row.
   *
   * Observed rather than theorised — the list refused to open at all while
   * being driven quickly, with `aria-expanded` flipping true and then false on
   * its own. Holding the handle and clearing it on every open makes the last
   * intent win, which is the only thing that can be correct here.
   */
  const closeTimer = useRef<number | null>(null);

  const openSuggestions = (i: number) => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpenRow(i);
  };

  const closeSuggestionsSoon = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpenRow(-1);
    }, 150);
  };
  const [holes, setHoles] = useState(18);
  const [nine, setNine] = useState("front");
  const [useHandicaps, setUseHandicaps] = useState(false);
  const [courseId, setCourseId] = useState("");
  /** "" means playing for nothing, which is the default and stays the default. */
  const [moneyGame, setMoneyGame] = useState("");
  /** The stake as typed, in whole currency units — "5", "2.50". */
  const [stake, setStake] = useState("");
  /**
   * Whether the stake is MONEY, or something the players sort out themselves.
   *
   * Most Sunday golf is played for a pint, lunch or nothing at all, and this
   * screen only had a box for pounds — so a fourball playing skins for the
   * next round of drinks either invented a stake nobody agreed or left the
   * game off the round entirely and kept it on a scorecard in somebody's
   * pocket.
   *
   * Money stays the default because it is what the box was for, and because
   * defaulting the other way would quietly stop recording stakes people do
   * agree in cash.
   */
  const [stakeKind, setStakeKind] = useState<"money" | "other">("money");
  /** What they are playing for, when it is not money — "a pint", "lunch". */
  const [stakeNote, setStakeNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  /**
   * The round type, or NOTHING until one is picked.
   *
   * It fell back to the first entry, which meant the screen quietly behaved as
   * a Match Play round — two-player ceiling and all — before anybody had
   * chosen. Undefined here is the honest state, and every reader below says
   * what it does without one.
   */
  const chosen = QUICK_ROUND_FORMATS.find((f) => f.name === format);
  /** Players per side, and one until a pairs format says otherwise. */
  const sideSize = chosen?.sideSize ?? 1;

  /**
   * The stake in minor units, from what was typed.
   *
   * Built here rather than in the domain because the domain takes minor units
   * — an integer number of pennies is unambiguous, and "5.00" is not. Anything
   * unparseable becomes 0, which `planMatch` then refuses by name if a game
   * was chosen; that is better than guessing at a number that is money.
   */
  const stakeCents = (() => {
    const n = Number(stake.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  })();

  /**
   * The whole money answer, built once so the preview and the submit cannot
   * disagree — the same reason `planned` is computed from the same object the
   * action is sent.
   *
   * The two halves are mutually exclusive by construction here, which is what
   * lets `planMatch` refuse the combination outright rather than having to
   * decide which one the person meant.
   *
   * A blank description still counts as an answer. Somebody who picked
   * "Something else" and typed nothing has said the thing that matters — this
   * is not for money — and being refused for not naming the pint would be the
   * screen arguing with them. "Not for money" is what the round then says it
   * is played for, which is exactly true.
   */
  const moneyChoice = {
    game: moneyGame,
    stakeCents: stakeKind === "other" ? 0 : stakeCents,
    stakeNote: stakeKind === "other" ? stakeNote.trim() || "Not for money" : "",
  };

  /**
   * Games this round type can actually run.
   *
   * A Nassau is three bets on ONE match, so it needs two sides to be between.
   * Filtering it out here rather than showing it and refusing later means the
   * screen never offers a wager the round cannot hold.
   */
  const moneyGames = QUICK_MONEY_GAMES.filter((g) => !g.matchOnly || chosen?.headToHead);


  /**
   * Whether a full card is what this round type would ask for anyway.
   *
   * Asked of the FORMAT's own declaration rather than guessed from whether it
   * is a head-to-head. Match play's first input is who won the hole; stroke
   * play's only input is the card. Getting that from `entryModesFor` is the
   * same source the entry screen reads, so the note below cannot claim a
   * change that screen will not make — the catalogue and the entry screen had
   * already drifted once over exactly this, which is why the list lives on
   * the format.
   */
  const cardIsNatural = chosen ? entryModesFor(chosen.name)[0] === "gross-cards" : false;
  const exact = chosen ? exactPlayersFor(chosen) : null;
  const ceiling = exact ?? QUICK_ROUND_MAX_PLAYERS;
  const named = players.filter((p) => p.name.trim().length > 0);

  const setPlayer = (i: number, patch: Partial<Entrant>) =>
    setPlayers((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  /**
   * Typing detaches the row from the member it was.
   *
   * Without this, picking Dave off the roster and then correcting the name to
   * "Dave S." would keep Dave's `memberId` — so the round would carry a player
   * called one thing and linked to another, and the handicap on screen would
   * stop being the one being used. Editing the name means this is somebody
   * else until they say otherwise.
   */
  const typeName = (i: number, name: string) => {
    setPlayer(i, { name, memberId: "" });
    // Typing re-opens the list. Focus alone is not enough: dismissing it with
    // Escape and then carrying on typing would otherwise leave somebody
    // filtering a list they cannot see.
    openSuggestions(i);
  };

  /** Take the member's name AND their index — the reason to pick at all. */
  const pickMember = (i: number, m: RosterMember) => {
    setPlayer(i, { name: m.name, hcp: m.handicap, memberId: m.id });
    setOpenRow(-1);
  };

  /**
   * Members matching what has been typed, minus anyone already in the round.
   *
   * Excluding the ones already entered is not tidiness: `planMatch` refuses a
   * round with two players of the same name, so offering a name that is
   * already in the list is offering the one choice guaranteed to be rejected.
   */
  const suggestionsFor = (i: number, typed: string): RosterMember[] => {
    const taken = new Set(
      players.filter((_, j) => j !== i).map((p) => p.name.trim().toLowerCase()).filter(Boolean),
    );
    const q = typed.trim().toLowerCase();
    return members
      .filter((m) => !taken.has(m.name.toLowerCase()))
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .slice(0, 6);
  };

  /**
   * Picking a round type opens the rows it needs, and never closes any.
   *
   * Four-Ball needs four names and the screen starts with two, so without this
   * the first thing choosing it does is produce an error about a number the
   * player has been given no way to reach. Growing is safe; SHRINKING is what
   * this deliberately does not do — switching from Four-Ball back to Match
   * Play would delete two names somebody had typed, and the error asking them
   * to remove two is recoverable in a way that silently binning them is not.
   */
  const chooseFormat = (name: string) => {
    setFormat(name);
    const picked = QUICK_ROUND_FORMATS.find((f) => f.name === name);
    const want = picked ? exactPlayersFor(picked) : null;
    if (want !== null) {
      setPlayers((prev) =>
        prev.length >= want
          ? prev
          : [
              ...prev,
              ...Array.from({ length: want - prev.length }, () => ({
                name: "",
                hcp: "",
                memberId: "",
              })),
            ],
      );
    }
  };

  /**
   * The same answer the server will give, computed as they type.
   *
   * Not a preview of it — literally it. The alternative is a second copy of
   * "match play is two players" in this file, and the one thing this codebase
   * keeps rediscovering is that two copies of a rule is how one of them ends
   * up wrong.
   */
  const planned = planMatch({
    players: players.map((p) => ({ name: p.name, handicap: useHandicaps ? p.hcp : 0, memberId: p.memberId })),
    format,
    holes,
    nine: holes === 9 ? nine : "full",
    useHandicaps,
    courseId,
    money: moneyChoice,
  });

  /**
   * Held back until there are two names to judge.
   *
   * "A round needs at least two players" is true of an empty form and useless
   * on one — it is the state every round starts in, and showing it there turns
   * the first keystroke into an error message.
   */
  const blocker = !planned.ok && named.length >= 2 ? planned.error : "";

  const submit = () => {
    if (!planned.ok) return;
    startTransition(async () => {
      setError("");
      const res = await createMatch({
        players: players.map((p) => ({ name: p.name, handicap: useHandicaps ? p.hcp : 0, memberId: p.memberId })),
        format,
        holes,
        nine: holes === 9 ? nine : "full",
        useHandicaps,
        courseId,
        money: moneyChoice,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't set that round up.");
        return;
      }
      // Straight to the card. The whole promise of this screen is that setting
      // a round up and starting it are one act, so landing on a dashboard —
      // with a checklist, about a tournament — would undo it at the last step.
      router.push("/entry");
    });
  };

  const pill = (active: boolean) => ({
    padding: "9px 14px",
    minHeight: 44,
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--color-text)",
    background: active ? "color-mix(in srgb, var(--color-accent) 16%, transparent)" : "var(--color-bg)",
    border: `1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}`,
  });

  return (
    <div className="card elev-sm" style={{ gap: 16 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>What are you playing?</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          One round, scored properly. For a series of rounds, a field to flight or a tee sheet,
          set up a tournament instead.
        </p>
      </div>

      {/* Grouped by SIDE SIZE, which is the same question as "on your own or
          in pairs" and is answered by choosing a round type rather than asked
          separately. Every entry is playable end to end — an engine, score
          entry and a board — and the same engines the tournament path uses. */}
      {[
        { size: 1, heading: "On your own" },
        { size: 2, heading: "In pairs" },
      ].map((group) => (
        <div key={group.size} style={{ display: "grid", gap: 8 }}>
          <span className="card-kicker">{group.heading}</span>
          {QUICK_ROUND_FORMATS.filter((f) => f.sideSize === group.size).map((f) => {
            const active = f.name === format;
            const needs = exactPlayersFor(f);
            return (
              <button
                key={f.name}
                type="button"
                onClick={() => chooseFormat(f.name)}
                aria-pressed={active}
                style={{
                  ...pill(active),
                  textAlign: "left",
                  padding: "11px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {active && <Icon name="check" />}
                  {f.name}
                  <span className="text-muted" style={{ fontWeight: 500, fontSize: 11.5 }}>
                    · {needs ? `${needs} players` : `${2}–${QUICK_ROUND_MAX_PLAYERS} players`}
                  </span>
                </span>
                <span className="text-muted" style={{ fontWeight: 400, fontSize: 11.5, lineHeight: 1.45 }}>
                  {f.blurb}
                </span>
              </button>
            );
          })}
        </div>
      ))}

      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Who&rsquo;s playing?</span>
        {/* THIS PARAGRAPH USED TO BE A WARNING AND IS NOW A PROMISE.

            It said "everyone joins your club roster", because every name typed
            here was pushed into the club by `upsertMember` — which filled a
            roster with people who are not members and, since a member with no
            email is matched BY NAME, let a second different Dave land on the
            first Dave's row and overwrite his index. The disclosure was
            honest; the behaviour was the problem.

            A guest is now a player on this round and nothing else. So the
            sentence can say the thing somebody actually wants to hear, and it
            is true. */}
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          {members.length > 0
            ? "Start typing to pick a member — their handicap comes with them. Anyone else is a guest: they play and they're scored, and they're not added to your club roster."
            : "Just names. Nobody needs an account to play, and nobody entered here is added to a club roster."}
        </p>
        {/* Said BEFORE the names are typed, not discovered afterwards.

            The sides are taken in entry order — the first two against the next
            two — and that is a rule the player has to know while they are
            typing, because it is the only thing that decides who they are
            partnering. A screen that pairs people silently and shows the
            result at the end has asked them to guess. */}
        {sideSize > 1 && (
          <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            <Icon name="users" /> Partners are taken in the order below — the first{" "}
            {sideSize} against the next {sideSize}.
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {players.map((p, i) => (
          <div key={i} style={{ display: "grid", gap: 4 }}>
            {/* The side heading, on the row that opens one. This is the
                pairing rule made concrete: it appears above player 1 and
                player 3, so "the first two against the next two" is something
                the screen SHOWS rather than something it claims. */}
            {sideSize > 1 && i % sideSize === 0 && (
              <span className="card-kicker" style={{ marginTop: i === 0 ? 0 : 6 }}>
                Side {Math.floor(i / sideSize) + 1}
              </span>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, minWidth: 0, position: "relative" }}>
              <label>
                Player {i + 1}
                {/* WHICH KIND OF PLAYER THIS IS, said on the row itself.

                    The difference is not cosmetic — a member's handicap is
                    the club's own and a guest's is whatever was typed — and
                    it is invisible once the name is in the box. Naming it
                    here is also the only honest place to promise that a
                    guest is not being filed into the club's roster. */}
                {/* Only where there is a roster to be a member OF.

                    With no club behind the screen — the common case, and the
                    whole free-tier point of it — "guest, not added to your
                    roster" names a roster that does not exist and draws a
                    distinction with nothing on the other side of it. */}
                {members.length === 0 ? null : p.memberId ? (
                  <span className="text-muted" style={{ fontWeight: 500, marginLeft: 6 }}>
                    · member
                  </span>
                ) : p.name.trim() ? (
                  <span className="text-muted" style={{ fontWeight: 500, marginLeft: 6 }}>
                    · guest, not added to your roster
                  </span>
                ) : null}
              </label>
              <input
                className="input"
                value={p.name}
                onChange={(e) => typeName(i, e.target.value)}
                onFocus={() => openSuggestions(i)}
                // Closed on a DELAY, not on blur directly: clicking a
                // suggestion blurs the input first, so an immediate close
                // removes the button before the click lands on it.
                onBlur={closeSuggestionsSoon}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpenRow(-1);
                  if (e.key === "Enter") submit();
                }}
                placeholder={i === 0 ? "You" : members.length ? "Search members, or type a name" : "Playing partner"}
                autoFocus={i === 1}
                autoComplete="off"
                role="combobox"
                aria-expanded={openRow === i}
                // A combobox has to NAME the list it controls, or a screen
                // reader announces a control with nothing attached to it. The
                // id exists whether or not the list is rendered, which is what
                // the role requires.
                aria-controls={`player-${i}-members`}
                aria-autocomplete="list"
                aria-label={`Player ${i + 1} name`}
              />
              {openRow === i && suggestionsFor(i, p.name).length > 0 && (
                <div
                  className="card elev-sm"
                  id={`player-${i}-members`}
                  role="listbox"
                  aria-label="Club members"
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    marginTop: 4,
                    padding: 4,
                    gap: 0,
                    maxHeight: 240,
                    overflowY: "auto",
                  }}
                >
                  {suggestionsFor(i, p.name).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      // `onMouseDown`, not `onClick`: mousedown fires before
                      // the input's blur, so the pick lands even though
                      // blurring is what closes this list.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickMember(i, m);
                      }}
                      style={{
                        display: "flex",
                        width: "100%",
                        minHeight: 44,
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "none",
                        background: "transparent",
                        color: "var(--color-text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.name}
                      </span>
                      {/* The index, shown BEFORE it is chosen. It is the
                          reason to pick a member rather than type them, and
                          it is also the number somebody would otherwise be
                          recalling from memory — which is the commonest way
                          a net round is scored wrong. */}
                      <span className="text-muted" style={{ flex: "none", fontSize: 11.5 }}>
                        {m.handicap}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {useHandicaps && (
              <div className="field" style={{ width: 104 }}>
                <label>Handicap</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={p.hcp}
                  onChange={(e) => setPlayer(i, { hcp: e.target.value })}
                  placeholder="12.4"
                />
              </div>
            )}
            {/* Never below two. A round with one person in it is a practice
                round, and this screen is for a competitive one. */}
            {players.length > 2 && (
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Remove player ${i + 1}`}
                style={{ minHeight: 44, minWidth: 44, padding: "0 12px" }}
                onClick={() => setPlayers((prev) => prev.filter((_, j) => j !== i))}
              >
                <Icon name="x" />
              </button>
            )}
            </div>
          </div>
        ))}

        {/* Below the ceiling: a way to add one. At it: a statement of what the
            game IS, and deliberately not a refusal.

            That line read "Match Play is played between two sides of 1 — that
            is 2. Pick another round type for a bigger group", and because
            match play is the default it was on the screen before anybody had
            done anything. Being told off on arrival for a choice you have not
            made is the wrong first impression; being told what you have
            chosen is not. */}
        {players.length < ceiling ? (
          <div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 44 }}
              onClick={() => setPlayers((prev) => [...prev, { name: "", hcp: "", memberId: "" }])}
            >
              <Icon name="plus" /> Add a player
            </button>
          </div>
        ) : (
          <p className="text-muted" style={{ fontSize: 11.5, margin: 0 }}>
            {exact
              ? `${chosen?.name} is ${headToHeadPhrase(sideSize)} — ${exact} players. Pick another round type for a bigger group.`
              : `${QUICK_ROUND_MAX_PLAYERS} is the most for a casual round — beyond two fourballs, set up a tournament.`}
          </p>
        )}
      </div>

      <div className="field">
        <label>How many holes?</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button type="button" style={pill(holes === 18)} onClick={() => setHoles(18)}>18 holes</button>
          <button type="button" style={pill(holes === 9)} onClick={() => setHoles(9)}>9 holes</button>
        </div>
        {holes === 9 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" style={pill(nine === "front")} onClick={() => setNine("front")}>Front nine</button>
            <button type="button" style={pill(nine === "back")} onClick={() => setNine("back")}>Back nine</button>
          </div>
        )}
      </div>

      {/* THE SCORING BASIS, ASKED IN PLAIN WORDS AND NAMED IN GOLF'S.

          This is the gross/net choice — `useHandicaps` is what becomes
          `scoringBasis` — and it was worded only as "Are shots being given?"
          on the reasoning that friends settling that on the first tee do not
          reach for the scoring vocabulary to do it. That reasoning still holds
          for the QUESTION, and it turned out to hide the answer: somebody
          looking for where a casual round picks gross or net could not find
          it, because neither word was on the screen.

          So both, and in the order they are thought in: the plain question
          leads, the term follows it in brackets. A player who does not know
          what "net" means still reads a sentence they understand; one who came
          looking for it now finds it. */}
      <div className="field">
        <label>Are shots being given?</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button type="button" style={pill(!useHandicaps)} onClick={() => setUseHandicaps(false)}>
            No — play level (gross)
          </button>
          <button type="button" style={pill(useHandicaps)} onClick={() => setUseHandicaps(true)}>
            Yes — off handicaps (net)
          </button>
        </div>
        {useHandicaps && (
          <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.5 }}>
            Strokes are given by stroke index, so a course with its card filled in is needed before
            this can be scored. Playing level needs nothing.
          </p>
        )}
      </div>

      {/* PLAYING FOR SOMETHING, asked here rather than on a screen afterwards.

          "We're in for a fiver" is agreed on the first tee at the same moment
          as everything else on this page, and sending somebody to a separate
          money screen to say so is exactly the extra step this whole path
          exists to remove.

          Off by default, and it stays off by default: a setup screen that
          asks "how much?" before it asks anything else has made a bet the
          condition of playing. */}
      <div className="field">
        <label>Playing for anything?</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button type="button" style={pill(moneyGame === "")} onClick={() => setMoneyGame("")}>
            No — just the golf
          </button>
          {moneyGames.map((g) => (
            <button
              key={g.key}
              type="button"
              style={pill(moneyGame === g.key)}
              onClick={() => setMoneyGame(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        {moneyGame !== "" && (
          <>
            <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.5 }}>
              {moneyGames.find((g) => g.key === moneyGame)?.blurb}
            </p>
            {/* MONEY IS NOT THE ONLY THING PEOPLE PLAY FOR, and this screen
                behaved as though it were: one box, marked in pounds, required
                before the game could be created.

                Most Sunday golf is played for a pint, for lunch, for the next
                green fee, or for nothing but the bragging. A fourball agreeing
                that either invented a stake nobody said or left the game off
                the round entirely — which is the pocket scorecard this whole
                path exists to replace.

                Money stays first and stays the default. The app records what
                people agreed; it has never moved a penny either way, and a
                round played for a pint is one where there is simply nothing to
                record. */}
            <div className="field" style={{ marginTop: 10 }}>
              <label>What for?</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <button type="button" style={pill(stakeKind === "money")} onClick={() => setStakeKind("money")}>
                  Money
                </button>
                <button type="button" style={pill(stakeKind === "other")} onClick={() => setStakeKind("other")}>
                  Something else
                </button>
              </div>
            </div>
            {stakeKind === "money" ? (
              <div className="field" style={{ maxWidth: 180, marginTop: 10 }}>
                <label htmlFor="quick-stake">Stake each</label>
                <input
                  id="quick-stake"
                  className="input"
                  inputMode="decimal"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  placeholder="5"
                  aria-label="Stake per player"
                />
              </div>
            ) : (
              <div className="field" style={{ maxWidth: 280, marginTop: 10 }}>
                <label htmlFor="quick-stake-note">
                  Playing for <span className="text-muted" style={{ fontWeight: 400 }}>— optional</span>
                </label>
                <input
                  id="quick-stake-note"
                  className="input"
                  value={stakeNote}
                  onChange={(e) => setStakeNote(e.target.value)}
                  placeholder="a pint"
                  maxLength={STAKE_NOTE_MAX}
                  aria-label="What the round is played for"
                />
                {/* Said plainly, because the difference between this and a
                    stake is the whole point: the app keeps the score and names
                    the winner, and there is no figure for anyone to settle. */}
                <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.5 }}>
                  Scored and settled the same way — the app just won&rsquo;t put a figure on it. Whatever
                  you agreed is between you.
                </p>
              </div>
            )}
            {/* THE SENTENCE THIS APP HAS TO KEEP SAYING. It works out who owes
                whom and writes it down; it never moves a penny. Said here
                because this is the moment somebody first agrees to money in
                it, and an app that took a stake without saying so would be
                claiming to be something it is not. */}
            <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.5 }}>
              {stakeKind === "money"
                ? "Everyone playing is in. The app works out who won what and who owes whom — it never takes or moves any money."
                : "Everyone playing is in. The app works out who won what, and records no money at all."}
            </p>
            {/* SAID WHERE THE CHOICE IS MADE, because the consequence lands on
                a different screen an hour later.

                Skins and a birdie pot settle off STROKES, and match play's
                natural input is who won the hole — so this round will ask for
                a full card rather than the A/½/B it would otherwise offer.
                Without saying so, somebody arrives at score entry expecting
                one thing and finds another, with no idea why. */}
            {moneyGames.find((g) => g.key === moneyGame)?.needsCards && !cardIsNatural && (
              <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.5 }}>
                <Icon name="note-pencil" /> This one is worked out from the scores, so you&rsquo;ll
                write down strokes on every hole rather than just who won it.
              </p>
            )}
          </>
        )}
      </div>

      {/* Only where there is something to pick. A brand-new account has no
          course library, and an empty picker offering one choice called
          "Decide later" is a question pretending to be a control.

          Directory search is OFF here, and this is the one screen where that
          is not a shortcut: importing a course reads the ACTIVE tournament to
          find the club it belongs to, and on this screen the tournament does
          not exist yet. The round's own venue picker has the full search the
          moment it is created. */}
      {/* WHERE, AND IT IS NOT OPTIONAL.

          This offered "Decide later", and that was the wrong shape for this
          screen: a casual round is impromptu, and whoever is setting one up is
          standing somewhere. Nobody arranges a Sunday fourball without knowing
          the course.

          What "Decide later" actually bought was a round that could not be
          scored. Score entry REFUSES a round whose scoring needs a card — a
          four-ball, any net round, any birdie pot — and sends you to a "Set up
          this course" form instead of the scorecard. So the screen whose
          promise is "nothing to configure" handed over a configuration form at
          the first tee. Measured on 2026-09-09.

          THE DIRECTORY IS ON HERE NOW, and it has to be. The club's library is
          read from the organizations this person belongs to, and somebody who
          has just signed up to play their mate on Sunday belongs to none — so
          requiring a course while offering only a list that is empty for a new
          user would be a wall rather than a question. */}
      <CoursePicker
        options={courses}
        value={courseId}
        onChange={setCourseId}
        label="Where are you playing?"
        searchDirectory
        hint="Needed before any score can go down — the card decides pars, stroke index and every shot given."
      />

      {(error || blocker) && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error || blocker}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={pending || !planned.ok || !courseId} onClick={submit}>
          {pending
            ? "Setting it up…"
            : planned.ok && !planned.plan.drawsMatch
              ? "Start the round"
              : "Start the match"}{" "}
          <Icon name="arrow-right" />
        </button>
        <span className="text-muted" style={{ fontSize: 11.5 }}>
          {/* NAMES THE NUMBER THIS FORMAT ACTUALLY WANTS.

              "Two names, and you're away" was written when Match Play was
              preselected and two was always the answer. It stopped being true
              twice over: once when the round type stopped being preselected,
              and once for every format that is not a singles match. Picking
              Four-Ball — four players, and the screen says so two inches
              above — still produced "Two names, and you're away", which is
              the app disagreeing with itself about how many people are
              needed, in the sentence whose whole job is to say what is left.

              Read off the screen on 2026-09-09.

              A hint that names the wrong remaining step is worse than none:
              it sends somebody back to the names they have already typed. */}
          {/* The course is asked LAST in this list and first in the form,
              because it is the one thing somebody arranging a round already
              knows — so naming it before the names would be pedantry, and
              naming it after them is the one step actually left. */}
          {planned.ok && courseId
            ? `Opens the card for ${planned.plan.name}.`
            : !format
              ? "Pick what you're playing, then who's in it."
              : !planned.ok
                ? exact
                  ? `${exact} names, and you're away.`
                  : "Two names is enough to start."
                : "Say where you're playing."}
        </span>
      </div>

      {/* SAID BEFORE, not discovered after.

          A casual round deletes itself about a day after it is set up, and the
          only thing that makes that acceptable is that nobody finds out
          afterwards. The round's own screen carries the same sentence with the
          button attached; this is the version that reaches somebody while they
          are still deciding whether to type four names in here. */}
      <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.55 }}>
        <Icon name="clock" /> A quick round is temporary — it&rsquo;s deleted about a day after
        you set it up, unless you keep it. Anything you want to hold on to belongs in a
        tournament.
      </p>
    </div>
  );
}
