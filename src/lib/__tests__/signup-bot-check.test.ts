import { describe, it, expect, vi } from "vitest";
import { readSource } from "./source";

vi.mock("server-only", () => ({}));
vi.mock("botid/server", () => ({ checkBotId: async () => ({ isBot: false }) }));

const { signUpLooksAutomated } = await import("@/lib/services/bot-check");

/**
 * The sign-up bot check: refuse a definite bot, and never let the CHECK be the
 * thing that stops a real club signing up. See bot-check.ts.
 */
describe("is this sign-up a script", () => {
  const bot = async () => ({ isBot: true });
  const person = async () => ({ isBot: false });
  const broken = async (): Promise<{ isBot: boolean }> => {
    throw new Error("The 'x-vercel-oidc-token' header is missing from the request.");
  };

  it("refuses a definite bot on Vercel", async () => {
    expect(await signUpLooksAutomated(bot, true)).toBe(true);
  });

  it("lets a person through", async () => {
    expect(await signUpLooksAutomated(person, true)).toBe(false);
  });

  it("asks nothing off Vercel, where the check cannot answer — dev, CI and the desktop shell", async () => {
    let asked = false;
    const spy = async () => {
      asked = true;
      return { isBot: true };
    };
    expect(await signUpLooksAutomated(spy, false)).toBe(false);
    expect(asked).toBe(false);
  });

  it("a check that fails lets the person in rather than stopping every sign-up", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await signUpLooksAutomated(broken, true)).toBe(false);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("is asked by signUp, before the account lookup", () => {
    const src = readSource("src", "app", "actions", "auth.ts");
    const body = src.slice(src.indexOf("export async function signUp"));
    const check = body.indexOf("signUpLooksAutomated()");
    const lookup = body.indexOf("prisma.user.findUnique");
    expect(check, "signUp does not ask the bot check").toBeGreaterThan(-1);
    expect(check).toBeLessThan(lookup);
  });
});
