/**
 * WHO WROTE A COMMENTARY LINE — the assistant, or the organizer.
 *
 * The list tags a line "AjAi" when its stored source is "ai", so a reader can
 * tell a machine wrote it. Nothing ever stored that: the panel posted every
 * line as the organizer's, drafted or not, and the tag was drawn for no line
 * at all.
 *
 * A line posted exactly as it was drafted is the assistant's. One the
 * organizer changed is theirs: they have put their name to words of their
 * own, and tagging an edited sentence as machine-written would be as untrue
 * as leaving an untouched one untagged.
 */
export type CommentarySource = "ai" | "organizer";

export function commentarySource(posted: string, drafted: string): CommentarySource {
  const draft = drafted.trim();
  return draft !== "" && posted.trim() === draft ? "ai" : "organizer";
}
