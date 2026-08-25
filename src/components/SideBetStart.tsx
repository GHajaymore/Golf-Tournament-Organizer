"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSkinsPot, setSkinsEntrants } from "@/app/actions/skins";
import { PersonChip } from "@/components/PersonChip";

/**
 * A bet between whoever wants in, across whatever fourballs they are in.
 *
 * The three shapes of skins this app now runs are the three that actually
 * happen: the club's pot (the organizer's), one fourball's own, and THIS —
 * six friends spread across three groups who agreed something on the first
 * tee. Before it existed the third could only be done by an organizer setting
 * up a field pot and ticking six of forty names, which is why it was done on
 * paper and settled in a group chat.
 *
 * It is a named pot rather than a new concept: the name is its group key, so
 * it settles, carries and pays exactly like every other pot, and lands in the
 * same one number per player at the end.
 *
 * The app works the money out and writes it down. It never moves it.
 */
export function SideBetStart({
  stageId,
  field,
  /** Names already taken on this round, so two bets cannot collide silently. */
  taken,
}: {
  stageId: string;
  field: Array<{ id: string; name: string }>;
  taken: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [buyIn, setBuyIn] = useState("5");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const trimmed = name.trim();
  const clash = taken.some((t) => t.toLowerCase() === trimmed.toLowerCase());
  // Two people minimum: a skins game against yourself has no one to win it
  // from, and every hole would carry to the end and pay you back your stake.
  const valid = trimmed.length > 0 && !clash && picked.size > 1;

  const create = () => {
    setError("");
    startTransition(async () => {
      const cents = Math.round(parseFloat(buyIn || "0") * 100);
      const made = await saveSkinsPot(stageId, {
        buyInCents: Number.isFinite(cents) && cents >= 0 ? cents : 0,
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
      const entered = await setSkinsEntrants(stageId, true, "full", [...picked], trimmed);
      if (!entered.ok) {
        setError(entered.error ?? "Started it, but couldn't add everyone.");
        return;
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

  return (
    <section className="card elev-sm" style={{ marginTop: 16, gap: 12 }}>
      <span className="card-title" style={{ fontSize: 15 }}>Start a side bet</span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
        For a game that is not the club&rsquo;s and not one fourball&rsquo;s — whoever is in,
        wherever they are playing. It settles like any other pot and lands in the same one number.
      </p>

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

      {clash && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          There is already a bet called that on this round. Give this one its own name.
        </p>
      )}

      <div>
        <span className="card-kicker">Who is in</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {field.map((p) => (
            <PersonChip
              key={p.id}
              name={p.name}
              on={picked.has(p.id)}
              onClick={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                })
              }
            />
          ))}
        </div>
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.5 }}>
          Anyone in the field, whichever group they are out in. Once there are names in it, only
          the people in it can change it.
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
