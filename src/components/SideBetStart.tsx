"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSkinsPot, setSkinsEntrants } from "@/app/actions/skins";
import { saveSideGame, setSideGameEntrants } from "@/app/actions/side-games";
import { DERIVED_LABEL, DERIVED_HELP } from "@/lib/domain/derived-games";
import { PersonChip } from "@/components/PersonChip";
import { useMoney } from "@/components/CurrencyProvider";
import { nameHold, type NameHold } from "@/lib/domain/bet-name";

/**
 * A bet between whoever wants in, across whatever fourballs they are in.
 *
 * The shapes of side game this app runs are the ones that actually happen: the
 * club's (the organizer's), one fourball's own, and THIS — the two, three or
 * six players who agreed something on the first tee. Before it existed the
 * last could only be done by an organizer setting up a field pot and ticking
 * six of forty names, which is why it was done on paper and settled in a group
 * chat.
 *
 * PLAYERS start these, not the organizer. The organizer configures the
 * tournament's money; a bet between two people in a fourball is theirs, and
 * `requirePotAccess` is the rule that says so for the skins pot and the derived
 * games alike.
 *
 * It is a named game rather than a new concept: the name is its group key, so
 * it settles, carries and pays exactly like every other pot, and lands in the
 * same one number per player at the end.
 *
 * The app works the money out and writes it down. It never moves it.
 */

/**
 * What can be started here, and nothing else.
 *
 * A Nassau is deliberately absent: it is a bet inside a match between two
 * players, not a pot with entrants, so offering it in a picker of "who is in"
 * would ask a question it has no answer to.
 */
const GAMES = [
  {
    kind: "skins",
    label: "Skins",
    help: "Low score wins the hole. Ties carry to the next one.",
  },
  { kind: "birdies", label: DERIVED_LABEL.birdies, help: DERIVED_HELP.birdies },
  { kind: "eagles", label: DERIVED_LABEL.eagles, help: DERIVED_HELP.eagles },
  { kind: "low-net", label: DERIVED_LABEL["low-net"], help: DERIVED_HELP["low-net"] },
  { kind: "low-gross", label: DERIVED_LABEL["low-gross"], help: DERIVED_HELP["low-gross"] },
] as const;

export function SideBetStart({
  stageId,
  field,
  /**
   * Names already taken on this round, PER GAME, so two bets cannot collide
   * silently — and so two games that should coexist are not refused.
   *
   * The store keys a game on (round, kind, name), so the same crew running
   * both skins and a birdie pot under one name is not a clash at all: it is
   * two rows that settle together, which is the point of sharing the name.
   * Refusing it was the old check being too strict. A kind of `"*"` reserves
   * a name across every game — that is what a tee-sheet group name is, because
   * an ad-hoc bet borrowing it would silently narrow its own audience to that
   * fourball.
   */
  taken,
  /**
   * The round's tee sheet, so people can be picked from where they are playing.
   *
   * Optional: a casual round with no draw published is still a round people bet
   * on, and it falls back to the plain field list. Anyone not on the sheet is
   * still offered — a bet does not require having been drawn.
   */
  groups = [],
}: {
  stageId: string;
  field: Array<{ id: string; name: string }>;
  taken: NameHold[];
  groups?: Array<{ name: string; playerIds: string[] }>;
}) {
  const { parse } = useMoney();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [game, setGame] = useState<string>("skins");
  const [buyIn, setBuyIn] = useState("5");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const trimmed = name.trim();
  // Taken, and WHY — the two reasons need two different sentences, and the
  // rule lives in domain/bet-name so this and the server cannot disagree.
  const held = nameHold(trimmed, game, taken);
  const clash = !!held;
  // Two people minimum: a game against yourself has no one to win it from, and
  // every hole would carry to the end and pay you back your stake.
  const valid = trimmed.length > 0 && !clash && picked.size > 1;

  const byId = new Map(field.map((p) => [p.id, p]));

  /**
   * The picker, laid out the way the round is.
   *
   * Names in a flat alphabetical list of forty is a list you scan; names under
   * the group they are teeing off in is a list you recognise, because the
   * people you are betting with are the people you are walking with. Anyone
   * not on the sheet lands in a final bucket rather than disappearing.
   */
  const drawn = new Set(groups.flatMap((g) => g.playerIds));
  const buckets: Array<{ name: string; players: Array<{ id: string; name: string }> }> = [
    ...groups
      .map((g) => ({
        name: g.name,
        players: g.playerIds.map((id) => byId.get(id)).filter((p): p is { id: string; name: string } => !!p),
      }))
      .filter((b) => b.players.length > 0),
    {
      name: groups.length > 0 ? "Not drawn" : "",
      players: field.filter((p) => !drawn.has(p.id)),
    },
  ].filter((b) => b.players.length > 0);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** One tap for the commonest case: the fourball you are standing in. */
  const addAll = (ids: string[]) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const allIn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const create = () => {
    setError("");
    startTransition(async () => {
      const parsed = parse(buyIn);
      const cents = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      const ids = [...picked];

      // Two different stores because they are two different games, not one
      // with a flag: a skins pot carries and a birdie pot does not, and the
      // arithmetic for each lives with its own rows. The name is the same
      // group key either way, which is what makes them settle together.
      if (game === "skins") {
        const made = await saveSkinsPot(stageId, {
          buyInCents: cents,
          net: true,
          scope: "full",
          groupKey: trimmed,
        });
        if (!made.ok) {
          setError(made.error ?? "Couldn't start that.");
          return;
        }
        // Named in a second call, which is also the moment the bet stops being
        // open to everyone and belongs to the people in it.
        const entered = await setSkinsEntrants(stageId, true, "full", ids, trimmed);
        if (!entered.ok) {
          setError(entered.error ?? "Started it, but couldn't add everyone.");
          return;
        }
      } else {
        const made = await saveSideGame(stageId, game, cents, trimmed);
        if (!made.ok || !made.id) {
          setError(made.error ?? "Couldn't start that.");
          return;
        }
        const entered = await setSideGameEntrants(made.id, ids);
        if (!entered.ok) {
          setError(entered.error ?? "Started it, but couldn't add everyone.");
          return;
        }
      }

      setOpen(false);
      setName("");
      setPicked(new Set());
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-secondary touch-target"
        style={{ marginTop: 16, alignSelf: "flex-start" }}
        onClick={() => setOpen(true)}
      >
        <i className="ph ph-plus" /> Start a side bet
      </button>
    );
  }

  const chosen = GAMES.find((g) => g.kind === game) ?? GAMES[0];

  return (
    <section className="card elev-sm" style={{ marginTop: 16, gap: 12 }}>
      <span className="card-title" style={{ fontSize: 15 }}>Start a side bet</span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
        Yours to set up — no organizer needed. Pick the game, pick who is in, and it settles
        like every other pot into the same one number.
      </p>

      <div>
        <span className="card-kicker">The game</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {GAMES.map((g) => (
            <button
              key={g.kind}
              type="button"
              className={`btn ${game === g.kind ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: 12.5, padding: "6px 12px" }}
              aria-pressed={game === g.kind}
              onClick={() => setGame(g.kind)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.5 }}>
          {chosen.help}
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label>What to call it</label>
          <input
            className="input"
            value={name}
            maxLength={40}
            placeholder="Saturday sweep"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>Buy-in</label>
          <input className="input" inputMode="decimal" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} />
        </div>
      </div>

      {held && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          {held.kind === "*" ? (
            <>
              {held.name} is a group out on the course, and that game is theirs to run. Give yours
              its own name.
            </>
          ) : (
            <>
              There is already a {chosen.label.toLowerCase()} game called that on this round. Give
              this one its own name.
            </>
          )}
        </p>
      )}

      <div>
        <span className="card-kicker">Who is in</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {buckets.map((b, i) => {
            const ids = b.players.map((p) => p.id);
            const allIn = ids.every((id) => picked.has(id));
            return (
              <div key={b.name || `bucket-${i}`}>
                {b.name && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 6,
                      minWidth: 0,
                    }}
                  >
                    <span className="text-muted" style={{ fontSize: 11.5, minWidth: 0 }}>
                      {b.name}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      onClick={() => addAll(ids)}
                    >
                      {allIn ? "None" : "All"}
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {b.players.map((p) => (
                    <PersonChip
                      key={p.id}
                      name={p.name}
                      on={picked.has(p.id)}
                      onClick={() => toggle(p.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.5 }}>
          Two players or ten, from any group. Once there are names in it, only the people in it
          can change it.
        </p>
      </div>

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 2 }}
          disabled={pending || !valid}
          onClick={create}
        >
          {picked.size > 1 ? `Start it with ${picked.size}` : "Pick at least two"}
        </button>
      </div>
    </section>
  );
}
