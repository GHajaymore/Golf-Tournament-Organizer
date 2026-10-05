import Link from "next/link";
import { Icon } from "@/components/Icon";
import { MoreInfo } from "@/components/MoreInfo";
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

  /* A WARNING IN ONE LINE, ITS REASON AN ⓘ AWAY (Ajay, 2026-10-05). The full
     sentence was 30-odd words under every scorecard; the short line says the
     fact, and the reason — and the way to fix it — is one tap behind it. A
     checked card is already one short line and stays as it was. */
  if (note.warn) {
    return (
      <MoreInfo warn short={note.short} style={{ marginTop: 8 }}>
        {note.text}
        {fix && (
          <>
            {" "}
            <Link href={fix} style={{ color: "var(--color-accent-200)", fontWeight: 600 }}>
              Check the card
            </Link>
          </>
        )}
      </MoreInfo>
    );
  }

  return (
    <p
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        margin: "8px 0 0",
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--color-text-muted)",
      }}
    >
      <Icon name="check" aria-hidden style={{ flex: "none", marginTop: 3 }} />
      <span>{note.text}</span>
    </p>
  );
}
