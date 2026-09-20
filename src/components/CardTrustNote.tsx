import Link from "next/link";
import { Icon } from "@/components/Icon";
import { cardTrustNote, type CardTrust } from "@/lib/domain/card-trust";

/**
 * WHETHER THIS COURSE CARD HAS BEEN CHECKED, ON THE SCREENS THAT SCORE AGAINST IT.
 *
 * The wording and the rules are in `domain/card-trust.ts`; this is how it
 * looks. One line, never a dialog and never a refusal: an unchecked card is
 * usable, and the club decides.
 *
 * `fix` is the way to do something about it — the course library, for somebody
 * who can. Omitted for a player, who should still know what their net score
 * was worked out from but cannot go and correct the club's card.
 */
export function CardTrustNote({
  card,
  fix,
  formatDate,
  strokeIndex,
}: {
  card: CardTrust | null | undefined;
  /** Where the card can be checked, for a reader who may. */
  fix?: string;
  formatDate?: (d: Date) => string;
  /**
   * The card's stroke index, where the caller has it.
   *
   * Omitted means "I did not look", which must not read as "there is none" —
   * so a caller that cannot see the index gets the ordinary note and no false
   * alarm about handicap strokes.
   */
  strokeIndex?: readonly number[] | null;
}) {
  const note = cardTrustNote(card, new Date(), formatDate, strokeIndex);
  if (!note) return null;

  return (
    <p
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        margin: "8px 0 0",
        fontSize: 12.5,
        lineHeight: 1.55,
        color: note.warn ? "var(--color-warning)" : "var(--color-text-muted)",
      }}
    >
      <Icon name={note.warn ? "warning-circle" : "check"} aria-hidden style={{ flex: "none", marginTop: 2 }} />
      <span>
        {note.text}
        {note.warn && fix && (
          <>
            {" "}
            <Link href={fix} style={{ color: "inherit", fontWeight: 600 }}>
              Check the card
            </Link>
          </>
        )}
      </span>
    </p>
  );
}
