"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HoleByHoleCard, type CardPlayer } from "@/components/HoleByHoleCard";
import { saveScorecard } from "@/app/actions/tournament";
import { usePendingCard } from "@/components/usePendingCard";
import { cardRevision, type SyncStatus } from "@/lib/domain/pending-card";

export interface GroupPartner {
  id: string;
  name: string;
  strokes: (number | null)[];
  revision: string;
}

/**
 * ONE PHONE, THE WHOLE FOURSOME — the marker system on a screen.
 *
 * The player's OWN card is not kept here. It stays with `PlayerCard`, which
 * owns its queue, its conflict chooser and signing, and this component hands
 * its holes straight back through `onSetMine`. What this adds is the
 * partners: each gets a queue of its own (`PartnerQueue`), because each is a
 * separate card on the server with its own revision.
 *
 * A PARTNER'S CARD THAT CHANGED ELSEWHERE IS NEVER OVERWRITTEN. The partner
 * may be keeping their own card on their own phone as well. When a save comes
 * back as a conflict this takes THEIR stored card, says so, and drops what
 * this phone had for them — the partner's own entry wins over their marker's,
 * and nobody's numbers are lost without a person seeing it happen. The
 * chooser `PlayerCard` shows for the player's own card is the right tool for
 * one's own numbers and the wrong one for somebody else's.
 *
 * Saving a partner's card is allowed by `saveScorecard` for the foursome on
 * the round's published tee sheet and nobody else; signing it is not.
 */
export function GroupScoring({
  stageId,
  holes,
  pars,
  yards,
  strokeIndex,
  me,
  myStrokes,
  onSetMine,
  partners,
  holding,
}: {
  stageId: string;
  holes: number;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  me: CardPlayer;
  myStrokes: (number | null)[];
  onSetMine: (hole: number, value: number | null) => void;
  partners: GroupPartner[];
  /** The tournament takes whole cards only: keep them on the phone until whole. */
  holding: (strokes: (number | null)[]) => boolean;
}) {
  const [cards, setCards] = useState<Record<string, (number | null)[]>>(() =>
    Object.fromEntries(partners.map((p) => [p.id, Array.from({ length: holes }, (_, i) => p.strokes[i] ?? null)])),
  );
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const report = useCallback((id: string, s: SyncStatus) => {
    setStatuses((prev) => (prev[id]?.label === s.label && prev[id]?.tone === s.tone ? prev : { ...prev, [id]: s }));
  }, []);
  const takeTheirs = useCallback((id: string, name: string, strokes: (number | null)[]) => {
    setCards((prev) => ({ ...prev, [id]: Array.from({ length: holes }, (_, i) => strokes[i] ?? null) }));
    setNotes((prev) => ({
      ...prev,
      [id]: `${name.split(" ")[0]}’s card was changed on another phone. Showing theirs — check it before you go on.`,
    }));
  }, [holes]);

  const setHole = (playerId: string, hole: number, value: number | null) => {
    if (playerId === me.id) {
      onSetMine(hole, value);
      return;
    }
    setNotes((prev) => (prev[playerId] ? { ...prev, [playerId]: "" } : prev));
    setCards((prev) => {
      const next = [...(prev[playerId] ?? [])];
      next[hole] = value;
      return { ...prev, [playerId]: next };
    });
  };

  return (
    <div>
      {partners.map((p) => (
        <PartnerQueue
          key={p.id}
          stageId={stageId}
          partner={p}
          strokes={cards[p.id]}
          holding={holding(cards[p.id] ?? [])}
          onStatus={report}
          onTheirs={takeTheirs}
        />
      ))}

      <HoleByHoleCard
        players={[me, ...partners.map((p) => ({ id: p.id, name: p.name }))]}
        cards={{ [me.id]: myStrokes, ...cards }}
        pars={pars}
        yards={yards}
        strokeIndex={strokeIndex}
        holes={holes}
        onSet={setHole}
        meId={me.id}
      />

      {/* Where each partner's card has got to — the same words the player's
          own card uses, so "Saved" means the same thing on every line. */}
      <ul aria-label="Your group’s cards" style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {partners.map((p) => (
          <li key={p.id} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            <strong style={{ fontWeight: 600 }}>{p.name}</strong>
            <span className="text-muted"> — {statuses[p.id]?.label ?? "No changes yet"}</span>
            {notes[p.id] && (
              <span role="status" style={{ display: "block", color: "var(--color-text)" }}>
                {notes[p.id]}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One partner's card on its way to the server — kept on the phone first, like
 * every card in the app (`usePendingCard`). Renders nothing: it exists so each
 * partner has a hook of their own, which a loop over a changing list cannot.
 */
function PartnerQueue({
  stageId,
  partner,
  strokes,
  holding,
  onStatus,
  onTheirs,
}: {
  stageId: string;
  partner: GroupPartner;
  strokes: (number | null)[] | undefined;
  holding: boolean;
  onStatus: (id: string, s: SyncStatus) => void;
  onTheirs: (id: string, name: string, strokes: (number | null)[]) => void;
}) {
  /** The revision the server holds, as far as this phone last heard. */
  const revision = useRef(partner.revision);

  const queue = usePendingCard<(number | null)[]>({
    stageId,
    playerId: partner.id,
    holding,
    send: async (value) => {
      const res = await saveScorecard(stageId, partner.id, value, revision.current);
      if (!res.ok) {
        // Theirs wins. "sent" empties the queue, which is the point: a retry
        // would overwrite the partner's own entry the moment it stopped
        // disagreeing.
        revision.current = res.conflict.revision;
        onTheirs(partner.id, partner.name, res.conflict.strokes);
        return "sent";
      }
      revision.current = res.revision;
      return "sent";
    },
  });

  const { push } = queue;
  useEffect(() => {
    // Only a card that differs from the server's is worth sending — which
    // skips the card as loaded, and the partner's own card after taking it.
    if (strokes && cardRevision(strokes) !== revision.current) push(strokes);
  }, [strokes, push]);

  useEffect(() => {
    onStatus(partner.id, queue.status);
  }, [queue.status, onStatus, partner.id]);

  return null;
}
