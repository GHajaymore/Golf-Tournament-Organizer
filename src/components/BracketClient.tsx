"use client";
import { useState, useTransition } from "react";
import { setBracketWinner } from "@/app/actions/tournament";
import type { BracketView } from "@/lib/domain";

function BracketBoard({ view }: { view: BracketView }) {
  const [pending, startTransition] = useTransition();

  const slotButton = (
    matchKey: string,
    slot: { playerId: string | null; seed: number | null; name: string },
    winnerId: string | null,
  ) => {
    const isWinner = winnerId !== null && slot.playerId === winnerId;
    const clickable = slot.playerId !== null;
    return (
      <button
        type="button"
        disabled={!clickable || pending}
        onClick={() => clickable && startTransition(() => setBracketWinner(matchKey, slot.playerId!))}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "9px 11px",
          border: "none",
          background: isWinner ? "var(--color-accent-800)" : "transparent",
          color: isWinner ? "var(--color-accent-100)" : "var(--color-text)",
          cursor: clickable ? "pointer" : "default",
          fontSize: 13,
          fontWeight: isWinner ? 600 : 400,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slot.name}</span>
        <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>{slot.seed ?? ""}</span>
      </button>
    );
  };

  return (
    <div className="card elev-sm" style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 26, minWidth: 640 }}>
        {view.rounds.map((rd) => (
          <div
            key={rd.roundIndex}
            style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 14, minWidth: 180 }}
          >
            <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-500)", textAlign: "center" }}>
              {rd.label}
            </div>
            {rd.matches.map((m) => (
              <div key={m.key} style={{ border: "1px solid var(--color-divider)", borderRadius: 8, overflow: "hidden" }}>
                {slotButton(m.key, m.a, m.winnerId)}
                <div style={{ height: 1, background: "var(--color-divider)" }} />
                {slotButton(m.key, m.b, m.winnerId)}
              </div>
            ))}
          </div>
        ))}
        <div style={{ flex: "none", width: 150, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 6, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>Champion</div>
          <i className="ph-fill ph-trophy" style={{ fontSize: 30, color: "var(--color-accent)" }} />
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 15 }}>
            {view.champion?.name ?? "TBD"}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BracketClient({ winners, consolation }: { winners: BracketView; consolation: BracketView }) {
  const [tab, setTab] = useState<"winners" | "consolation">("winners");
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="page-kicker">Bracket</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Bracket manager</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Seeded from qualification. Click a name to advance the winner (click again to undo).
          </p>
        </div>
        <div className="seg">
          <label className="seg-opt">
            <input type="radio" name="brk" checked={tab === "winners"} onChange={() => setTab("winners")} />
            Winners
          </label>
          <label className="seg-opt">
            <input type="radio" name="brk" checked={tab === "consolation"} onChange={() => setTab("consolation")} />
            Consolation
          </label>
        </div>
      </div>
      <BracketBoard view={tab === "winners" ? winners : consolation} />
    </>
  );
}
