/**
 * When an announcement can be posted, and what to say when it cannot.
 *
 * `addAnnouncement` refuses an untitled post on its second line and returns
 * without a word. That is the right place for the RULE — a `"use server"`
 * export is a public endpoint and cannot trust a caller — but it left the
 * screen with a Post button that is enabled, clickable, and does nothing at
 * all: no message, no focus, not one character of the page changes. An
 * organizer who typed their notice into the field labelled "Message" and
 * pressed Post was simply ignored.
 *
 * So the rule is stated once, here, and both sides read it: the composer to
 * say why it will not send, and a test to pin what it says.
 *
 * Pure and separate from the component because the interesting case — a body
 * typed with no title — is a state the screen only reaches after two edits,
 * and the demo event has no announcements at all, so nothing that renders the
 * page can reach it either.
 */

/**
 * Why this post cannot go out, or null when it can.
 *
 * TWO REFUSALS, NOT ONE. An empty composer needs a nudge; a composer with a
 * message and no title needs an EXPLANATION, because that organizer has not
 * forgotten anything — they reasonably think the message is the message. The
 * answer is that the title is the part players actually see on the dashboard,
 * so saying that is the whole fix.
 */
export function postRefusal(title: string, body: string): string | null {
  if (title.trim()) return null;
  if (body.trim()) {
    return "Give this a title — it's the line players see on their dashboard.";
  }
  return "Add a title before posting.";
}

/** Whether the composer holds a postable announcement. */
export function canPost(title: string, body: string): boolean {
  return postRefusal(title, body) === null;
}
