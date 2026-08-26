import type {
  HandicapAuthority,
  IndexLookup,
  IntegrationCredential,
  IntegrationStatus,
  RoundToPost,
  ScorePost,
  ScoreReporter,
} from "./types";

/**
 * GHIN — the USGA's handicapping system.
 *
 * DELIBERATELY NOT IMPLEMENTED. There is no contract, no credential and no
 * endpoint. Access comes through the USGA or through GHIN itself, a club
 * arranges it, and until one has there is nothing here to call.
 *
 * So this exists to be HONEST about that rather than to hide it. Every method
 * reports `unconfigured` and returns a reason, and the app is built to handle
 * that reason as a first-class state — see `handicapStanding`, which decides
 * what a club plays off when the association cannot be reached, and answers
 * "the last index you actually received, labelled with its age" rather than
 * "zero".
 *
 * The alternative — leaving GHIN off the settings screen until the day an API
 * appears — is worse than it looks. A club evaluating this app needs to know
 * the path exists before committing a season to it, and an integration bolted
 * on later tends to be bolted on badly, because by then the handicap code has
 * been written on the assumption that a figure is always to hand.
 *
 * WHEN THE CREDENTIALS ARRIVE, the work is inside these two functions and
 * nowhere else. Everything around them — the policy, the staleness rule, the
 * outbox, the settings screen, the tests — is already built and already
 * exercised against the unconfigured path, which is the path that has to keep
 * working anyway on the day the association has an outage.
 */

const NOT_YET =
  "GHIN is not connected. A club arranges access with the USGA or GHIN, then " +
  "adds the credentials in Settings.";

const HOW =
  "Contact the USGA or your association to request GHIN API access for your club, " +
  "then paste the credentials into Settings → Handicaps.";

function statusOf(credential: IntegrationCredential | null): IntegrationStatus {
  // A credential row with an empty secret is somebody who started and stopped,
  // which is not the same as never having tried — but it is equally unusable,
  // and treating it as ready is how a club discovers the gap mid-competition.
  if (!credential || !credential.secret.trim()) return "unconfigured";
  // Nothing can accept it yet, so nothing may claim it is ready. When there is
  // an endpoint, this is where a stored verification result is read.
  return "unconfigured";
}

export const ghinAuthority: HandicapAuthority = {
  id: "ghin",
  label: "GHIN (USGA)",
  howToEnable: HOW,
  status: statusOf,
  async lookup(golferId: string, credential): Promise<IndexLookup> {
    if (statusOf(credential) !== "ready") {
      return { ok: false, reason: "unconfigured", detail: NOT_YET };
    }
    /* istanbul ignore next — unreachable until an endpoint exists */
    return { ok: false, reason: "unavailable", detail: `No lookup implemented for ${golferId}.` };
  },
};

export const ghinReporter: ScoreReporter = {
  id: "ghin",
  label: "GHIN (USGA)",
  howToEnable: HOW,
  status: statusOf,
  async post(round: RoundToPost, credential): Promise<ScorePost> {
    if (statusOf(credential) !== "ready") {
      /**
       * NOT retryable, and that distinction matters here more than anywhere.
       *
       * A queued post that keeps retrying against an integration nobody has
       * set up is a queue that grows all season and then, on the day the
       * credentials land, posts a winter's worth of scores to every member's
       * record at once. Unconfigured is a decision not to post, not a
       * temporary failure.
       */
      return { ok: false, reason: "unconfigured", detail: NOT_YET, retryable: false };
    }
    /* istanbul ignore next — unreachable until an endpoint exists */
    return {
      ok: false,
      reason: "unavailable",
      detail: `No posting implemented for ${round.golferId}.`,
      retryable: true,
    };
  },
};
