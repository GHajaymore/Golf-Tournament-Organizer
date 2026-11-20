/**
 * ONE BROWSER FOR A TEST THAT ENTERS ON THE PUBLIC LINK (2026-11-13).
 *
 * A code belongs to the browser that asked for it (`services/email-code.ts`), so a
 * test that enters through `enterOnTheLink` needs `next/headers` to hand every call
 * the same cookie jar. A file with no other use for `next/headers` mocks it with
 * this, from inside the factory (a factory cannot see the file's own variables):
 *
 *   vi.mock("next/headers", async () => (await import("./link-browser")).linkBrowser());
 *
 * No imports from the app: this file is loaded while `next/headers` is being mocked.
 */
const jar = new Map<string, string>();

export function linkBrowser() {
  return {
    cookies: async () => ({
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => void jar.set(name, value),
      delete: (name: string) => void jar.delete(name),
    }),
    headers: async () => new Headers(),
  };
}
