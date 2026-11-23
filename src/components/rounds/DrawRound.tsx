/**
 * "DRAW ROUND n's MATCHES" lives in `components/DrawRound.tsx` since R9b: Rounds & formats and Tee times & draw both
 * mount it, and a file of one screen's area may not be imported by the other's. This keeps the old path for the
 * Rounds files that import it.
 *
 * DEBT, owner: the Rounds lane (R4d / R16 cleanup), due when #1221 has merged: point `RoundsScreen`, `StagesClient`
 * (which #1225 must not edit) at `@/components/DrawRound` and delete this file. Dated 23 Nov 2026.
 */
export { DrawRound } from "../DrawRound";
export type { DrawRoundStage } from "../DrawRound";
