import { SkinsSeason } from "@/components/SkinsSeason";
import { FloatClient } from "@/components/FloatClient";
import { OrganizerLedger } from "@/components/OrganizerLedger";
import type { MoneyMode } from "@/lib/domain/money-mode";
import type { SettleHalf as SettleHalfView } from "@/lib/services/money-settle";

/**
 * THE SETTLE HALF OF A TOURNAMENT'S MONEY, drawn once (R8b): the season's skins, the kitty when the tournament keeps one, and
 * the ledger for the person collecting. Prizes & payouts mounts it while Winners & money is not shown and Winners & money
 * mounts it when it is: `moneyPartOf`'s boolean is the page's one `shown.has("money")`, so it is never on both.
 *
 * No directive: a server component, and it imports only components from the client files (never one of their helpers).
 * It carries no figure of its own; what it draws was read through the sinks by `settleHalfFor`.
 */
export function SettleHalf({
  settle,
  moneyMode,
  rounds,
  isStaff,
}: {
  settle: SettleHalfView;
  moneyMode: MoneyMode;
  rounds: Array<{ id: string; label: string }>;
  isStaff: boolean;
}) {
  return (
    <>
      <SkinsSeason rows={settle.skinsSeason} />

      {/* The kitty, when this tournament keeps one. Below the pots because the pots are what people ask about on the day,
          and the kitty is what the organizer reconciles afterwards. */}
      {moneyMode === "float" && (
        <FloatClient
          lines={settle.fundLines.map((l) => ({
            id: l.id,
            direction: l.direction,
            description: l.description,
            amountCents: l.amountCents,
            category: l.category,
            occurredOn: l.occurredOn,
            stageId: l.stageId,
            createdBy: l.createdBy,
          }))}
          rounds={rounds}
          canEdit={isStaff}
        />
      )}

      {/* The ledger, for the person collecting. The settle-up used to live only on the player screen, which works for an
          organizer who is also playing and fails completely for the one who is not: a society treasurer is the likeliest
          person to need it. */}
      {settle.ledger && <OrganizerLedger view={settle.ledger} />}
    </>
  );
}
