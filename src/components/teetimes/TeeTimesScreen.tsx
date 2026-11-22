import Link from "next/link";
import type { ReactNode } from "react";
import { MoreInfo } from "@/components/MoreInfo";
import { RoundPicker, type PickableRound } from "@/components/RoundPicker";
import { RoundColumn } from "@/components/setup/RoundColumn";
import { consoleUrl, type ConsoleMode } from "@/lib/console-url";
import { DRAW_SECTION_TITLES, type DrawSectionKey } from "@/lib/domain/draw-sections";
import type { FindPlayer, FindRound } from "@/lib/domain/find-a-player";
import { FindAPlayer } from "./FindAPlayer";
import { SectionFold } from "./SectionFold";

/**
 * TEE TIMES & DRAW, the redesigned screen for a stroke or Stableford round (R9a; step 3 §2.2).
 *
 * Top to bottom, the TD's order of work: the head (kicker, the one name, Find a player), the round's
 * tabs with the machine's chip, "This round needs", then the sections `drawSections` chose. It COMPUTES
 * NOTHING: the page hands it the machine's answers (the chip is `courseDayOf`'s, the needs are the round's
 * own, the Needs you mark is `needsYouSection`'s) and the section bodies, which are the components the
 * tee sheet already draws. Shown only while the redesign switch is on for `teeTimes`.
 *
 * Colours are `--color-*` tokens; every flex child has `min-width: 0`.
 */
export interface DrawNeedLine {
  key: string;
  text: string;
  /** A section's anchor on this screen, or the Rounds screen where the need is put right. */
  href: string;
}

export interface TeeTimesScreenProps {
  /** `phaseTitle("draw", family)`: "Tee times", "Draw", "Lineups", "This week". */
  kicker: string;
  roundLabel: string;
  roundChip: { chip: string; tone: "accent" | "accent-2" | "neutral" };
  /** One tab per playing round; each label carries the round's chip. */
  tabs: PickableRound[];
  activeStageId: string;
  /** Null for anybody who is not staff. */
  find: { players: readonly FindPlayer[]; rounds: readonly FindRound[]; nextUnplayedId: string | null } | null;
  needs: readonly DrawNeedLine[];
  /** The sections to draw, in order (`drawSections`). */
  keys: readonly DrawSectionKey[];
  needsYou: DrawSectionKey | null;
  sections: Partial<Record<DrawSectionKey, { state: string; node: ReactNode }>>;
  /** While the screen is only previewed (`?stepper=1`), its links keep the preview on; null once it is on for everybody. */
  previewMode: ConsoleMode | null;
  /** Drawn above the sections: the members ask on an empty field. */
  above?: ReactNode;
}

/** Open on a phone: the section marked Needs you, and the sheet itself (the draw). */
const SHEET: DrawSectionKey = "draw";

export function TeeTimesScreen({ kicker, roundLabel, roundChip, tabs, activeStageId, find, needs, keys, needsYou, sections, previewMode, above }: TeeTimesScreenProps) {
  const to = (href: string) => (previewMode && !href.startsWith("#") ? consoleUrl(href, previewMode) : href);
  const carry = previewMode ? consoleUrl("/", previewMode).split("?")[1] : undefined;
  return (
    <>
      <div style={{ marginBottom: 20, minWidth: 0 }}>
        <div className="page-kicker">{kicker}</div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "8px 24px", minWidth: 0 }}>
          <h1 className="page-title" style={{ margin: 0, minWidth: 0 }}>
            Tee times &amp; draw
          </h1>
          {find && (
            <div style={{ flex: "1 1 260px", minWidth: 0, maxWidth: 480 }}>
              <FindAPlayer players={find.players} rounds={find.rounds} nextUnplayedId={find.nextUnplayedId} previewMode={previewMode} />
            </div>
          )}
        </div>
        <MoreInfo short="Who plays together, in what order, from which tee." style={{ marginTop: 6 }}>
          Once a round has been played you can re-pair off the leaderboard and send the leaders out last.
        </MoreInfo>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, minWidth: 0, marginBottom: 8 }}>
        <RoundPicker rounds={tabs} activeStageId={activeStageId} carry={carry} label="Round" style={{ minHeight: 48, minWidth: 0, maxWidth: "100%" }} />
      </div>
      <RoundColumn label={roundLabel} chip={roundChip} ring={null}>
        {needs.length > 0 && (
          <div data-this-round-needs="" className="card elev-sm" style={{ gap: 6, marginTop: 4, borderLeft: "3px solid var(--color-accent)" }}>
            <span className="card-title" style={{ fontSize: 14 }}>
              This round needs
            </span>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              {needs.map((n) => (
                <li key={n.key} style={{ fontSize: 14, lineHeight: 1.5, minWidth: 0, overflowWrap: "anywhere" }}>
                  <Link href={to(n.href)} style={{ display: "inline-block", minHeight: "var(--tap-min, 24px)" }}>
                    {n.text}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </RoundColumn>

      {above}

      {keys.map((k) => {
        const s = sections[k];
        if (!s) return null;
        return (
          <SectionFold key={k} id={k} title={DRAW_SECTION_TITLES[k]} state={s.state} needsYou={needsYou === k} openOnPhone={needsYou === k || k === SHEET}>
            {s.node}
          </SectionFold>
        );
      })}
    </>
  );
}
