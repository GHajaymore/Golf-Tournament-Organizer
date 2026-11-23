"use client";
import type { TransitionStartFunction } from "react";
import Link from "next/link";
import { screenName } from "@/lib/nav";
import { regenerateRoundCode } from "@/app/actions/settings";
import { formatAccessCode, roundCodeLink } from "@/lib/code-format";
import { roundShareMessage } from "@/lib/domain/share-message";
import { Icon } from "../Icon";
import { ConfirmButton } from "../ConfirmButton";
import { useGolfTerms } from "../GolfTermsProvider";
import { useCopy } from "./use-copy";

export interface RoundCode {
  stageId: string;
  label: string;
  code: string;
}

/**
 * ROUND CODES: one code per round, to copy, share, reissue and print. Lifted out of `PlaySettings`
 * (R3-1), no behaviour change; Home (R10) mounts it. The caller draws it only while codes are on.
 *
 * `run` is the caller's own transition, so a reissue still holds the whole form while it works, and
 * `onError` says a refusal where the caller says every other one.
 */
export function RoundCodes({
  rounds,
  eventName,
  canEdit,
  pending,
  run,
  onError,
}: {
  rounds: RoundCode[];
  eventName: string;
  canEdit: boolean;
  pending: boolean;
  run: TransitionStartFunction;
  onError: (message: string) => void;
}) {
  const golf = useGolfTerms();
  const { origin, canShare, copied, copy } = useCopy();

  /**
   * SHARE A ROUND'S CODE (2026-11-05): the one sentence (`roundShareMessage`) to the phone's
   * share sheet where it has one, otherwise to the clipboard ("Copy message"). A cancelled
   * share sheet is not an error. The text is never posted anywhere by us: it goes where the
   * organizer sends it, which is why the section says not to make it public.
   */
  const shareRound = async (r: RoundCode) => {
    const text = roundShareMessage({
      eventName,
      roundLabel: r.label,
      code: r.code,
      link: roundCodeLink(origin || window.location.origin, r.code),
    });
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: [eventName, r.label].filter(Boolean).join(", "), text });
      } catch {
        // Closed without sending.
      }
      return;
    }
    copy(text, `message:${r.stageId}`);
  };

  return (
    <div data-this-tournament="" style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
      <span className="card-title" style={{ fontSize: 14 }}>Round Codes</span>
      <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 8px" }}>
        One code per round. Players scan the round&apos;s sign or type the code, then tap their group.
        Anyone with the code can report a score for that round, so reissue it if it travels beyond the field.
      </p>
      <p className="text-muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
        <b>Share</b> sends the players a message with the link and the code. Send it to the players or their group
        chat, and don&apos;t post it publicly: anyone who reads it can report a score.
      </p>

      {rounds.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Codes appear here once the tournament has rounds. Add them on {screenName("/stages")}.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Round</th>
                <th style={{ width: 150 }}>Code</th>
                <th style={{ width: 330 }} />
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.stageId}>
                  <td>{r.label}</td>
                  <td style={{ fontFamily: "var(--font-mono, monospace)", letterSpacing: "0.06em" }}>
                    {r.code ? formatAccessCode(r.code) : "—"}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.code && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 13, minHeight: "var(--tap-min, 36px)" }}
                        onClick={() => copy(formatAccessCode(r.code), r.stageId)}
                      >
                        <Icon name="copy" /> {copied === r.stageId ? "Copied" : "Copy"}
                      </button>
                    )}
                    {r.code && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 13, minHeight: "var(--tap-min, 36px)", marginLeft: 6 }}
                        aria-label={`${canShare ? "Share" : "Copy a message with"} the ${r.label.toLowerCase()} code`}
                        onClick={() => void shareRound(r)}
                      >
                        <Icon name="share-network" />{" "}
                        {copied === `message:${r.stageId}` ? "Message copied" : canShare ? "Share" : "Copy message"}
                      </button>
                    )}
                    {/* ASKED FIRST (2026-10-17, the cup's UI review): one tap beside Copy replaced the
                        code printed on every cart sign and tee sheet, and every player holding it was
                        refused from then on. */}
                    {canEdit && (
                      <span style={{ marginLeft: 6, display: "inline-block" }}>
                        <ConfirmButton
                          icon="arrows-clockwise"
                          label="Reissue"
                          title={`Reissue the code for ${r.label}`}
                          confirmLabel={r.code ? `Stop ${formatAccessCode(r.code)}` : "Make a code"}
                          note={r.code ? `Players holding ${formatAccessCode(r.code)} will be refused, and its printed signs stop working.` : undefined}
                          className="btn btn-secondary"
                          style={{ fontSize: 13, minHeight: "var(--tap-min, 36px)" }}
                          disabled={pending}
                          onConfirm={() =>
                            run(async () => {
                              const res = await regenerateRoundCode(r.stageId);
                              if (!res.ok) onError(res.error ?? "Couldn't reissue the code.");
                            })
                          }
                        />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* THE ROUND'S SIGN, printed through the Print kit (2026-10-23): the one way to the printer, so
          the sign here and the cart signs there cannot drift apart. The sign itself is unchanged — the
          round, a QR to `/play#CODE`, the code in large letters. */}
      {rounds.some((r) => r.code) && (
        <p style={{ margin: "10px 0 0", fontSize: 13 }}>
          <Link
            href={`/print?round=${rounds.find((r) => r.code)!.stageId}&docs=spare,signs`}
            className="btn btn-secondary"
            style={{ fontSize: 13, minHeight: "var(--tap-min, 36px)", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="qr-code" /> Print the signs
          </Link>{" "}
          <span className="text-muted">One sign per round for walk-ins and the first tee, and a named one for every {golf.cart}, in the {screenName("/print")}.</span>
        </p>
      )}
    </div>
  );
}
