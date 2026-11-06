"use client";
import { useState, useTransition } from "react";
import { placeInTeeGroup } from "@/app/actions/tee-sheet";
import { startHoleNumber } from "@/lib/domain/hole-number";
import { teedOffCaution, type GroupWithRoom } from "@/lib/domain/tee-sheet";
import { Icon } from "./Icon";

/**
 * PUT IN A GROUP — one named player, one group with room (day-of field
 * changes, PR B).
 *
 * The players this round's field holds whom the saved sheet places nowhere: a
 * late entry, a reserve who moved in from the waiting list. Each gets the
 * groups that have room (`groupsWithRoom`, fewer than four of the field) and
 * one button. Nobody else moves and no time changes; moving a player who is
 * already drawn stays a re-draw.
 *
 * Panel review of #1029:
 *   - a group already OUT on the course (`markTeedOff`) stays selectable but is
 *     marked "teed off" and listed last, and choosing it says, in one line,
 *     that joining it is the Committee's call;
 *   - nothing is chosen for you: the select starts on "Choose a group" and the
 *     button waits for a choice;
 *   - when the one field rule refuses (`door`, only a completed tournament),
 *     the choice and the button are not drawn at all — the screen never offers
 *     a press the server refuses — and the rule's sentence is said instead.
 */
export function PlaceInGroup({
  stageId,
  undrawn,
  groups,
  door,
  firstHole = 1,
}: {
  stageId: string;
  /** In the round's field, on no group of the saved sheet. */
  undrawn: Array<{ id: string; name: string }>;
  /** The saved sheet's groups with room for one more, the ones already out marked and last (`markTeedOff`). */
  groups: GroupWithRoom[];
  /** Why nobody can be placed now (`fieldRefusal(…, "place-in-group")`), or null. */
  door: string | null;
  /** The course's number for the card's first hole — 10 on a back nine. */
  firstHole?: number;
}) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // The last one placed empties the list; what the press did is still said.
  if (undrawn.length === 0) {
    return said ? (
      <p role="status" className="card elev-sm" style={{ marginBottom: 16, fontSize: 14 }}>
        {said}
      </p>
    ) : null;
  }

  // The option's own group, matched by its value — never a number read out of a box, never a default.
  const chosen = (id: string) => groups.find((g) => String(g.index) === choice[id]) ?? null;

  const put = (p: { id: string; name: string }) => {
    const g = chosen(p.id);
    if (!g) return;
    startTransition(async () => {
      const res = await placeInTeeGroup(stageId, p.id, g.index);
      if (res.ok) {
        setError("");
        setSaid(res.said ?? "");
      } else {
        setSaid("");
        setError(`${p.name}: ${res.error ?? "That did not save."}`);
      }
    });
  };

  const label = (g: GroupWithRoom) =>
    `${g.name} · ${g.time ? `${g.time} · ` : ""}hole ${startHoleNumber(g.startHole, firstHole)}${g.half ?? ""} · ${g.players} ${g.players === 1 ? "player" : "players"}${g.teedOff ? " · teed off" : ""}`;

  return (
    <section
      aria-label="Put in a group"
      className="card elev-sm"
      style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8, borderLeft: "3px solid var(--color-accent)" }}
    >
      <span className="card-title" style={{ fontSize: 14 }}>
        <Icon name="user-plus" /> Not in a group yet ({undrawn.length})
      </span>
      {door ? (
        <>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 14 }}>
            {undrawn.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{door}</p>
        </>
      ) : groups.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13 }}>Every group is full. Re-draw the sheet to make room.</p>
      ) : (
        <>
          <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Put each one in a group with room. Nobody else moves and no time changes.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {undrawn.map((p) => {
              const g = chosen(p.id);
              return (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14, minWidth: 0 }}>
                  <span style={{ flex: "1 1 140px", minWidth: 0, fontWeight: 500 }}>{p.name}</span>
                  <select
                    aria-label={`Group for ${p.name}`}
                    className="input"
                    style={{ flex: "2 1 220px", minWidth: 0, minHeight: 44 }}
                    value={choice[p.id] ?? ""}
                    disabled={pending}
                    onChange={(e) => setChoice((c) => ({ ...c, [p.id]: e.target.value }))}
                  >
                    <option value="">Choose a group</option>
                    {groups.map((x) => (
                      <option key={x.index} value={String(x.index)}>
                        {label(x)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ minHeight: 44, fontSize: 13 }}
                    disabled={pending || !g}
                    onClick={() => put(p)}
                  >
                    Put in group
                  </button>
                  {g?.teedOff && (
                    <p role="note" style={{ flexBasis: "100%", margin: 0, fontSize: 13 }}>
                      <Icon name="warning-circle" /> {teedOffCaution(g)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {said && (
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          {said}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
