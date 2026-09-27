import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
function actionModule() {
  return new Proxy(
    {},
    { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) },
  ) as Record<string, unknown>;
}
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/roster", actionModule);
vi.mock("@/app/actions/messaging", actionModule);
vi.mock("@/app/actions/event", actionModule);

/**
 * ADDING A PLAYER TO A LOCKED TOURNAMENT — walked as the secretary on the live
 * April Medal, 2026-09-27.
 *
 * Every control on Registration is disabled while setup is locked except one:
 * the "Add someone new" form. So it could be filled in and pressed, and
 * `addSignup` — which refused a locked tournament by THROWING — took the whole
 * page down to "Application error: a server-side exception has occurred". And
 * the closed-registration banner above it said, in bold, "You can still add
 * players below".
 *
 * Three halves, each pinned: the button follows the lock, the banner stops
 * promising it, and the action answers in a sentence (asserted against a real
 * locked tournament in `locked-field-add.audit.test.ts`).
 */
const reg = async (locked: boolean) => {
  const { RegistrationClient } = await import("@/components/RegistrationClient");
  return renderToStaticMarkup(
    <RegistrationClient
      confirmed={[]} waitlist={[]} pendingEntries={[]} locked={locked} isAdmin roster={[]}
      event={{
        name: "zz-April Medal", capacity: 32, status: "live", regDeadline: "", regOpens: "",
        // Closed by hand (true is "closed" — `setRegistrationOverride(true)` is
        // the Close button), the state in which the banner offers "add below".
        registrationOverride: true, inviteMessage: "", organizationName: "zz-Club",
        dates: "", course: "", city: "", registrationOpen: false, registrationApproval: "auto",
        requirePhone: false, phoneLocked: false, registrationToken: "",
      }} />,
  );
};

describe("a locked tournament's Registration screen", () => {
  it("does not promise that players can still be added", async () => {
    const html = await reg(true);
    expect(html).toContain("Setup locked");
    expect(html).not.toContain("You can still add players below");
    expect(html).toContain("While it is closed the sign-up link turns everyone away.");
    // And says why the Add button is dead where the button is.
    expect(html).toContain("Setup is locked, so nobody can be added.");
  });

  it("still says so when setup is open (the control)", async () => {
    const html = await reg(false);
    expect(html).toContain("You can still add players below");
    expect(html).not.toContain("Setup is locked, so nobody can be added.");
  });

  it("gates the Add button on the lock, like the roster picker beside it", () => {
    const src = readSource("src", "components", "RegistrationClient.tsx");
    const at = src.indexOf("onClick={submitAdd}");
    expect(at).toBeGreaterThan(-1);
    const button = src.slice(src.lastIndexOf("<button", at), at);
    expect(button).toMatch(/disabled=\{pending \|\| locked \|\|/);
    // And the CSV import beside it.
    expect(src).toMatch(/type="file"[^>]*onChange=\{onFile\} disabled=\{pending \|\| locked\}/);
  });

  it("the action refuses in words rather than throwing", () => {
    const src = readSource("src", "app", "actions", "tournament.ts");
    const body = src.slice(src.indexOf("export async function addSignup("), src.indexOf("export async function addSignup(") + 2500);
    expect(body).toMatch(/if \(configurationLocked\(event\)\) \{\s*return \{ ok: false,/);
    expect(body).not.toMatch(/assertUnlocked/);
    const csv = src.slice(src.indexOf("export async function importCsvSignups("), src.indexOf("export async function importCsvSignups(") + 900);
    expect(csv).toMatch(/if \(configurationLocked\(event\)\) \{\s*return \{/);
    expect(csv).not.toMatch(/assertUnlocked/);
  });
});
