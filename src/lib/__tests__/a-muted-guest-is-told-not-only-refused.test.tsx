import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mutedWordsFor, scopeKey, MUTED_WORDS, type MembershipContext } from "@/lib/domain/messaging";
import { readSource } from "./source";

vi.mock("@/app/actions/messaging", () => ({}));

/**
 * A MUTED GUEST IS TOLD, NOT ONLY REFUSED (J39/J40 PR 2, S8; CI on #1133).
 *
 * The organizer's Mute takes the round out of a guest's compose picker and the
 * reply box out of the round's thread (`canPostToScope`). The send's refusal had
 * the words, but nothing on screen reached it any more: the picker offered only
 * the desk, and the round thread said "This one is announcements only", which is
 * false of a conversation the guest wrote in an hour before. Now one rule
 * (`mutedWordsFor`) gives the words, and the send, the thread and the compose
 * card all say them.
 */

const ctx = (over: Partial<MembershipContext> = {}): MembershipContext => ({
  whoKey: "guest:zz-guest",
  guest: true,
  muted: true,
  role: "player",
  organizationId: "zz-org",
  eventId: "zz-event",
  playerId: "zz-guest",
  onRoster: false,
  groupIds: [],
  stageIds: ["zz-round"],
  teamIds: [],
  matchIds: [],
  foursomeIds: [],
  directThreadIds: [],
  staffScopes: { groupIds: [], stageIds: [], teamIds: [], playerIds: [] },
  ...over,
});

const ROUND = scopeKey("round", "zz-round");
const DESK = scopeKey("desk", "zz-guest");

describe("the words a muted guest is given", () => {
  it("in their round: the organizer's mute, said", () => {
    expect(mutedWordsFor(ctx(), ROUND)).toBe(MUTED_WORDS);
    expect(MUTED_WORDS).toMatch(/^Your organizer has turned off your posts here\./);
  });

  it("CONTROL: never on their own desk, never unmuted, never somewhere they cannot read", () => {
    expect(mutedWordsFor(ctx(), DESK), "the desk stays open").toBe("");
    expect(mutedWordsFor(ctx({ muted: false }), ROUND)).toBe("");
    expect(mutedWordsFor(ctx(), scopeKey("round", "zz-other-round")), "says a round exists that they are not in").toBe("");
  });
});

describe("the screens say them", () => {
  it("the thread's closed reply box says the mute, not 'announcements only'", async () => {
    const { ReplyClosed } = await import("@/components/MessagesClient");
    const muted = renderToStaticMarkup(<ReplyClosed mutedWords={MUTED_WORDS} organizer="organizer" />);
    expect(muted).toContain("Your organizer has turned off your posts here.");
    expect(muted, "a muted guest told their round is announcements only").not.toContain("announcements only");
    // CONTROL: an announcement thread still says what it is.
    expect(renderToStaticMarkup(<ReplyClosed mutedWords="" organizer="organiser" />)).toContain("announcements only — your organiser posts here.");
  });

  it("the compose card says why the round is not in its picker", async () => {
    const { ComposePanel } = await import("@/components/MessagesClient");
    const desk = [{ key: DESK, label: "Message the organizer", kind: "desk" }];
    const html = renderToStaticMarkup(<ComposePanel composable={desk} people={[]} isStaff={false} onOpen={() => {}} mutedWords={MUTED_WORDS} />);
    expect(html).toContain("data-muted-note");
    expect(html).toContain("Your organizer has turned off your posts here.");
    // CONTROL: nobody else is told it.
    expect(renderToStaticMarkup(<ComposePanel composable={desk} people={[]} isStaff={false} onOpen={() => {}} />)).not.toContain("data-muted-note");
  });

  it("the send, the thread and the player's screen all ask the one rule", () => {
    const service = readSource("src", "lib", "services", "messaging.ts");
    expect(service).toContain("mutedWords: mutedWordsFor(ctx, thread.scopeKey)");
    expect(service).toContain("const muted = mutedWordsFor(ctx, key);");
    expect(readSource("src", "components", "MessagesClient.tsx")).toContain("<ReplyClosed mutedWords={view.mutedWords}");
    expect(readSource("src", "app", "(player)", "me", "messages", "page.tsx")).toContain("mutedWords={ctx.muted ? MUTED_WORDS : \"\"}");
  });
});
