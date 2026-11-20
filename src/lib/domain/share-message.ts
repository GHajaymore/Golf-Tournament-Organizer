import { formatAccessCode } from "@/lib/code-format";

/**
 * THE MESSAGE AN ORGANIZER SENDS WITH A ROUND'S CODE (2026-11-05).
 *
 * A QR on a printed sign reaches the people at the course; the code also has to
 * reach the ones who are not standing in front of it — a group chat the night
 * before, a text to the captain. The Round Codes section's Share button hands
 * this sentence to the phone's share sheet, or copies it where there is none.
 *
 * Both ways in, one sentence: the link opens the round (and the player's
 * group), and the other way — open `/play` and type the code — is spelled out
 * for a phone that will not follow a link. The host is the real one, taken from
 * the link it is given, never a fixed domain (a preview, a club's own domain).
 * Plain text with no formatting characters, because it is pasted into places we
 * do not control.
 */
export function roundShareMessage(input: { eventName: string; roundLabel: string; code: string; link: string }): string {
  const what = [input.eventName, input.roundLabel].map((s) => s.trim()).filter(Boolean).join(", ");
  return `Scoring${what ? ` for ${what}` : ""}: tap ${input.link} — or open ${hostOf(input.link)}/play and type ${formatAccessCode(input.code)}`;
}

/** The host of an address, as a person would type it: no scheme, no path. */
export function hostOf(link: string): string {
  return link.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[/?#].*$/, "");
}
