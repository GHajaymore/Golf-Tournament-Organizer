"use client";
import { removeSignup } from "@/app/actions/tournament";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Icon } from "@/components/Icon";
import { useAction } from "@/components/useAction";
import { bringIntoView } from "@/lib/bring-into-view";
import {
  WITHDREW_WORDS,
  noCardReturnedLabel,
  noCardReturnedWords,
  type MissingCardPlayer,
} from "@/lib/domain/missing-cards";

/**
 * THE CARDS STILL TO COME, with the two answers (R12). Each player the round is owed a card from has the answer the board
 * will give if nothing is pressed (No card returned: no place, said in `unplacedWorking`'s own sentence), and one press for
 * the other (Withdrew: the withdrawal path that keeps the player on the sheet as WD). The round is closed by the tick below
 * it, which is the existing `RoundClosedControl`; nothing here closes anything or writes a new kind of fact.
 *
 * WITHDREW ASKS TWICE (`ConfirmButton`): it takes the player out of the rest of the event, not only this round. The
 * refusal is said under the list, an alert brought into view as the tick's is.
 */
export function MissingCards({ round, players, door }: { round: string; players: MissingCardPlayer[]; /** Why nobody can withdraw now (`fieldDoors(…).withdraw`), or null: the field rule, not the setup lock, which a launched tournament always holds. */ door: string | null }) {
  const { pending, error, run } = useAction({ refresh: true });
  if (players.length === 0) return null;
  const working = noCardReturnedWords(round);
  return (
    <div data-missing-cards style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <p style={{ margin: 0, fontWeight: 500 }}>
        {players.length === 1 ? "1 player has no card for" : `${players.length} players have no card for`} {round}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {players.map((p) => (
          <li
            key={p.id}
            data-missing-card={p.id}
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", minWidth: 0 }}
          >
            <span style={{ fontWeight: 500, minWidth: 0, overflowWrap: "anywhere" }}>{p.name}</span>
            <span className="tag tag-neutral" style={{ fontSize: 13 }}>
              {noCardReturnedLabel(round)}
            </span>
            <ConfirmButton
              className="btn btn-secondary touch-target"
              label="Withdrew"
              title={`${p.name} withdrew`}
              confirmLabel={`Yes, ${p.name} withdrew`}
              icon="sign-out"
              note="Out of the rest of the event too."
              disabled={pending || !!door}
              onConfirm={() => run(() => removeSignup(p.id))}
            />
          </li>
        ))}
      </ul>
      <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6, maxWidth: "62ch" }}>
        If you close the round with no card from them: {working.says} ({working.cite}). {WITHDREW_WORDS}
      </p>
      {/* The field rule's own refusal, said where Withdrew is greyed (the press it would have refused). */}
      {door && (
        <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          <Icon name="lock-simple" /> {door}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" ref={bringIntoView}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
