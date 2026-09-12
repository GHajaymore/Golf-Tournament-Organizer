import { resolveMoneyMode, MONEY_MODE_LABEL } from "@/lib/domain/money-mode";
import { orgProfile } from "@/lib/domain/org-profile";
import { Icon } from "./Icon";

/**
 * WHAT THIS TOURNAMENT DOES WITH MONEY, SAID BEFORE ANY OF IT IS SHOWN.
 *
 * The mode decides what every other card on the screen MEANS — whether there
 * is a kitty, whether shared costs are split, whether entry fees are the app's
 * business at all — and the control for it was the LAST thing on the screen,
 * under the ledger it governs:
 *
 *     PrizesClient → SkinsPotClient → ContestsClient → SkinsSeason
 *     → FloatClient → OrganizerLedger → MoneySetup
 *
 * So an organizer read a ledger and then found out whether the ledger applied.
 * And the club's setup step promises "Changeable per tournament later" without
 * saying where, which made scrolling to the bottom of Prizes the only way to
 * keep that promise.
 *
 * A STATEMENT, NOT A SECOND COPY OF THE PICKER. The radios stay where settings
 * belong — at the foot of the screen, with the other configuration — because
 * putting them at the top would push the prizes themselves below the fold to
 * solve a problem that is about KNOWING, not about changing. This says which
 * mode is in force and how it was arrived at, and offers a jump.
 */
export function MoneyModeLine({
  eventMode,
  orgMode,
  orgKind,
  clubName,
  /** Where the picker is. Staff only — a player has nothing to jump to. */
  href,
}: {
  eventMode: string;
  orgMode: string;
  orgKind: string;
  clubName: string;
  href?: string;
}) {
  const active = resolveMoneyMode({ eventMode, orgMode, orgKind });
  const profile = orgProfile(orgKind);
  /**
   * Whether this tournament chose, or is taking the club's answer.
   *
   * Worth saying out loud: "following the club" and "decided here" are the
   * difference between a change on Club settings reaching this tournament and
   * not, which is the question somebody asks the moment two tournaments in the
   * same club behave differently.
   */
  const inherited = eventMode === "";

  return (
    <div
      className="card elev-sm"
      style={{ marginBottom: 16, gap: 4, borderLeft: "3px solid var(--color-accent)" }}
    >
      <div className="card-head">
        <span className="card-kicker">Money in this tournament</span>
        {href && (
          <a href={href} className="btn btn-ghost" style={{ padding: "2px 10px", fontSize: 12 }}>
            Change <Icon name="arrow-down" />
          </a>
        )}
      </div>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>
        {MONEY_MODE_LABEL[active]}
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.55 }}>
        {inherited
          ? `Following ${clubName || `the ${profile.noun}`}. Change it here and this tournament stops following.`
          : "Chosen for this tournament, so the club's default no longer applies to it."}
      </p>
    </div>
  );
}
