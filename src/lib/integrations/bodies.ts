import type {
  HandicapAuthority,
  IndexLookup,
  IntegrationCredential,
  IntegrationStatus,
  RoundToPost,
  ScorePost,
  ScoreReporter,
} from "./types";
import { HANDICAP_BODIES, bodyInProse, type HandicapBody } from "@/lib/domain/handicap-body";

/**
 * THE NATIONAL BODIES BEYOND GHIN — every one NOT CONNECTED, and saying so.
 *
 * Same shape and same honesty as `ghin.ts`: no public API exists for any of
 * them (panel, 2026-10-17 — the home unions and Golf Canada license software
 * firms club by club; nothing public for Australia), so each reports
 * `unconfigured` with the way a club would ask for access, and the app plays
 * off the index already on file, labelled with its age, never zero.
 *
 * The words never claim an API exists. "Ask whether your club's software can
 * be licensed" is what is true.
 */

function statusOf(credential: IntegrationCredential | null): IntegrationStatus {
  // Nothing can accept a credential yet, so nothing may claim to be ready.
  if (!credential || !credential.secret.trim()) return "unconfigured";
  return "unconfigured";
}

function placeholder(body: HandicapBody): { authority: HandicapAuthority; reporter: ScoreReporter } {
  const who = bodyInProse(body);
  const notYet = `${body.name} is not connected. Indexes are entered here until it is.`;
  const how =
    body.id === "national"
      ? "Ask your national association whether your club's software can be licensed to read handicaps."
      : `Ask ${who} whether your club's software can be licensed to read handicaps from ${body.service}.`;
  return {
    authority: {
      id: body.id,
      label: body.name,
      howToEnable: how,
      status: statusOf,
      async lookup(_golferId: string, _credential): Promise<IndexLookup> {
        void _golferId;
        void _credential;
        return { ok: false, reason: "unconfigured", detail: notYet };
      },
    },
    reporter: {
      id: body.id,
      label: body.name,
      howToEnable: how,
      status: statusOf,
      // Never retryable while unconfigured — see `ghin.ts`: a queue that
      // retries against nothing posts a season of scores the day it connects.
      async post(_round: RoundToPost, _credential): Promise<ScorePost> {
        void _round;
        void _credential;
        return { ok: false, reason: "unconfigured", detail: notYet, retryable: false };
      },
    },
  };
}

const MADE = HANDICAP_BODIES.filter((b) => b.id !== "ghin").map(placeholder);

export const bodyAuthorities: HandicapAuthority[] = MADE.map((m) => m.authority);
export const bodyReporters: ScoreReporter[] = MADE.map((m) => m.reporter);
