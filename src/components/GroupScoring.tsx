"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HoleByHoleCard, type CardPlayer } from "@/components/HoleByHoleCard";
import { saveScorecard } from "@/app/actions/tournament";
import { usePendingCard } from "@/components/usePendingCard";
import { cardRevision, combineHoleSyncs, keptCardChanged, type HoleSync, type SyncStatus } from "@/lib/domain/pending-card";
import type { PinSheet } from "@/lib/domain/pin-sheet";
import { stablefordPickUp } from "@/lib/domain/card-points";
import { isPartnerCardSigned } from "@/lib/domain/card-approval";

export interface GroupPartner {
  id: string;
  name: string;
  strokes: (number | null)[];
  revision: string;
  /**
   * Handicap strokes per hole for THIS partner, resolved on the server the
   * same way as the holder's own. Absent means none to show.
   */
  shots?: number[];
  /** The card's status; anything but "entered" is signed or flagged — see `isPartnerCardSigned`. */
  status?: string;
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
  mySync,
  myRefusal = "",
  partners,
  holding,
  startHole = 1,
  showVoice = true,
  pins = [],
  firstHole = 1,
  dense = false,
  offerPickUp = false,
}: {
  /**
   * A STANDARD STABLEFORD round: every row on the hole may pick up (Rule
   * 21.1b), recorded as that player's own net double bogey — zero points, the
   * handicap system's figure for the hole (`stablefordPickUp`). The marker
   * keeping the foursome's cards is exactly who records a partner's pick-up,
   * so this is the group view's as much as the holder's own (2026-10-08).
   */
  offerPickUp?: boolean;
  /** The hole card's compact layout — see `HoleByHoleCard`'s `dense`. */
  dense?: boolean;
  /** The round's pin sheet, passed through to the hole card. */
  pins?: PinSheet;
  /** The course's number for the first hole on the card — 10 on a back nine. */
  firstHole?: number;
  /** The organizer's "Voice entry" setting — off, no microphone. */
  showVoice?: boolean;
  stageId: string;
  holes: number;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  me: CardPlayer;
  myStrokes: (number | null)[];
  onSetMine: (hole: number, value: number | null) => void;
  /** Where the holder's own holes are, from `PlayerCard`'s queue. */
  mySync: HoleSync[];
  /** The server's words for a refusal of the holder's own card. */
  myRefusal?: string;
  partners: GroupPartner[];
  /** The tournament takes whole cards only: keep them on the phone until whole. */
  holding: (strokes: (number | null)[]) => boolean;
  startHole?: number;
}) {
  const [cards, setCards] = useState<Record<string, (number | null)[]>>(() =>
    Object.fromEntries(partners.map((p) => [p.id, Array.from({ length: holes }, (_, i) => p.strokes[i] ?? null)])),
  );
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});
  /** Where each partner's holes are, as their own queue reports it. */
  const [partnerSync, setPartnerSync] = useState<Record<string, HoleSync[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const report = useCallback((id: string, s: SyncStatus, holesNow: HoleSync[]) => {
    setStatuses((prev) => (prev[id]?.label === s.label && prev[id]?.tone === s.tone ? prev : { ...prev, [id]: s }));
    setPartnerSync((prev) => ((prev[id] ?? []).join(",") === holesNow.join(",") ? prev : { ...prev, [id]: holesNow }));
  }, []);
  // ONE MARK A HOLE FOR THE GROUP: "Sent" only when every card on it is sent (`combineHoleSyncs`).
  const groupSync = combineHoleSyncs([mySync, ...partners.map((p) => partnerSync[p.id] ?? [])], holes);
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
    // A signed partner's card is not this phone's to write — a heard "Faye
    // five" included. The server refuses it too; this keeps it off the queue.
    if (isPartnerCardSigned(partners.find((p) => p.id === playerId)?.status)) return;
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
        // Each partner's shots on their own row, as the holder's are on theirs:
        // the marker keeping a net card has to see who gets a stroke here.
        players={[
          me,
          ...partners.map((p) => ({
            id: p.id,
            name: p.name,
            shotsOn: (h: number) => p.shots?.[h] ?? 0,
            signed: isPartnerCardSigned(p.status),
          })),
        ]}
        cards={{ [me.id]: myStrokes, ...cards }}
        pars={pars}
        yards={yards}
        strokeIndex={strokeIndex}
        holes={holes}
        onSet={setHole}
        meId={me.id}
        startHole={startHole}
        showVoice={showVoice}
        pins={pins}
        firstHole={firstHole}
        dense={dense}
        sync={groupSync}
        refusal={myRefusal}
        {...(offerPickUp
          ? (() => {
              const shotsOf = (id: string, h: number) =>
                id === me.id ? (me.shotsOn?.(h) ?? 0) : (partners.find((p) => p.id === id)?.shots?.[h] ?? 0);
              const all: Record<string, (number | null)[]> = { [me.id]: myStrokes, ...cards };
              return {
                pickedUp: Object.fromEntries(
                  Object.entries(all).map(([id, strokes]) => [
                    id,
                    strokes.map((v, i) => v != null && v === stablefordPickUp(pars[i] ?? 4, shotsOf(id, i))),
                  ]),
                ),
                onPickUp: (id: string, hole: number, on: boolean) =>
                  setHole(id, hole, on ? stablefordPickUp(pars[hole] ?? 4, shotsOf(id, hole)) : null),
              };
            })()
          : {})}
      />

      {/* Where each partner's card has got to — the same words the player's
          own card uses, so "Saved" means the same thing on every line. */}
      <ul aria-label="Your group’s cards" style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {partners.map((p) => (
          <li key={p.id} style={{ fontSize: 14, lineHeight: 1.5 }}>
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
  onStatus: (id: string, s: SyncStatus, holes: HoleSync[]) => void;
  onTheirs: (id: string, name: string, strokes: (number | null)[]) => void;
}) {
  /** The revision the server holds, as far as this phone last heard. */
  const revision = useRef(partner.revision);
  /**
   * The card as THIS PHONE last knew it — loaded, or sent. What "changed" is
   * measured against, and deliberately not `revision` above: for a partner
   * with no card the server's is "no card", which no card of any length
   * matches, so their blank card was sent the moment this view opened. See
   * `keptCardChanged`.
   */
  const known = useRef(cardRevision(strokes ?? []));

  const [drawn] = useState(() => (strokes ? [...strokes] : null));
  const queue = usePendingCard<(number | null)[]>({
    stageId,
    playerId: partner.id,
    holding,
    // The partner's card as the server held it when this view opened.
    drawnFrom: drawn,
    cells: (v) => v,
    send: async (value) => {
      const res = await saveScorecard(stageId, partner.id, value, revision.current);
      if (!res.ok) {
        // Theirs wins. Answering with their card empties the queue, which is
        // the point: a retry would overwrite the partner's own entry the moment
        // it stopped disagreeing. And the holes are measured against THEIR card,
        // which is what the server holds.
        revision.current = res.conflict.revision;
        // What the phone now holds is theirs, at the length it holds cards.
        const theirs = Array.from({ length: value.length }, (_, i) => res.conflict.strokes[i] ?? null);
        known.current = cardRevision(theirs);
        onTheirs(partner.id, partner.name, res.conflict.strokes);
        return { serverHolds: theirs, theirsWins: true };
      }
      revision.current = res.revision;
      known.current = cardRevision(value);
      // READ BACK: the partner's card as the row now holds it.
      return { serverHolds: Array.from({ length: value.length }, (_, i) => res.stored[i] ?? null) };
    },
  });

  const { push } = queue;
  useEffect(() => {
    // Only a card that has CHANGED on this phone is worth sending — which
    // skips the card as loaded (a partner's blank one included), and the
    // partner's own card after taking it.
    if (strokes && keptCardChanged(strokes, known.current)) push(strokes);
  }, [strokes, push]);

  // Joined, so the effect below fires when a hole's state changes and not on every render.
  const holesKey = queue.holes.join(",");
  useEffect(() => {
    onStatus(partner.id, queue.status, holesKey ? (holesKey.split(",") as HoleSync[]) : []);
  }, [queue.status, holesKey, onStatus, partner.id]);

  return null;
}
