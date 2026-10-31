import Link from "next/link";
import { Icon } from "@/components/Icon";
import { requireSession } from "@/lib/page-helpers";
import { screenMetadata } from "@/lib/screen-metadata";
import { screenName } from "@/lib/nav";
import { helpInClubWords, helpLineText } from "@/lib/player-help";
import { golfRegisterForEvent } from "@/lib/services/organization";
import { golfTermsFor } from "@/lib/domain/golf-terms";

export const metadata = screenMetadata("/me/help");

/**
 * HELP, FOR THE PLAYER (Ajay, 2026-10-10).
 *
 * The handful of things a player does, each as a question that opens onto
 * three or four short lines and a button to the screen it is about. Closed by
 * default: the page is a list of questions, and a player reads only the one
 * they came with.
 *
 * NOT A TAB — see PLAYER_HELP in `player-nav.ts`. The content is
 * `player-help.ts`, whose tests keep it covering every player screen and
 * naming only buttons the screens really draw; change that file in the same
 * pull request as any change to what a player sees or does.
 *
 * No model answers here, by decision: a written page cannot be confidently
 * wrong about a ruling, and costs nothing to run.
 */
export default async function PlayerHelpPage() {
  const session = await requireSession();
  // The club's golf words — "Ask your organiser" to a British member.
  const words = golfTermsFor(session.eventId ? await golfRegisterForEvent(session.eventId) : "us");
  const topics = helpInClubWords(words);
  return (
    <>
      <div className="page-kicker">Your club</div>
      <h1 className="page-title">Help</h1>
      <p style={{ margin: "8px 0 16px", fontSize: 14 }}>Tap a question to see how.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {topics.map((t) => (
          <details key={t.id} id={t.id} className="card elev-sm" style={{ padding: 0 }}>
            <summary
              style={{
                cursor: "pointer",
                minHeight: 48,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{t.question}</span>
              <Icon name="caret-down" className="text-muted" />
            </summary>
            <div style={{ padding: "0 14px 14px" }}>
              <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
                {t.steps.map((line) => (
                  <li key={line} style={{ fontSize: 14, lineHeight: 1.5 }}>
                    {helpLineText(line)}
                  </li>
                ))}
              </ol>
              <Link
                href={t.href}
                className="btn btn-secondary"
                style={{ marginTop: 12, minHeight: 44, alignSelf: "flex-start" }}
              >
                Open {screenName(t.href)} <Icon name="arrow-right" />
              </Link>
            </div>
          </details>
        ))}
      </div>

      <p className="text-muted" style={{ margin: "18px 0 0", fontSize: 14 }}>
        Still stuck? Ask your {words.organizer}.
      </p>
    </>
  );
}
