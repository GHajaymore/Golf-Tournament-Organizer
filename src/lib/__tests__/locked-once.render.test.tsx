import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("@/app/actions/tournament", () => ({ openCorrection: async () => ({ ok: true }), endCorrection: async () => ({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { LockedOnce } = await import("@/components/setup/LockedOnce");
const { SetupField } = await import("@/components/setup/SetupField");
const { SCOPE_LOCK_BANNER_ID } = await import("@/components/ScopeLockBanner");
const { locksFor, scopeLockOf } = await import("@/lib/domain/tournament-status");
const { facts, launched } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");

/**
 * A LOCKED SECTION SAYS WHY ONCE (R1b): two fields under one lock give ONE banner and no control.
 */

const lock = scopeLockOf(locksFor(launched(facts())), "sides")!;
const noop = () => {};

const section = (locks: (typeof lock)[]) =>
  renderToStaticMarkup(
    <div style={{ width: 320 }}>
      <LockedOnce locks={locks} isAdmin={true} correction={null} open={null}>
        {(locked) => (
          <>
            {["Allowance", "Tees"].map((label) => (
              <SetupField key={label} label={label} mark={null} dflt={null} isDefault={false} onChange={locked ? null : noop} onUseDefault={null}>
                value
              </SetupField>
            ))}
          </>
        )}
      </LockedOnce>
    </div>,
  );

describe("LockedOnce", () => {
  it("two fields inside one lock give exactly one banner region and no Change button", () => {
    const html = section([lock]);
    expect((html.match(new RegExp(`id="${SCOPE_LOCK_BANNER_ID}"`, "g")) ?? []).length).toBe(1);
    expect((html.match(/data-setup-field=/g) ?? []).length).toBe(2);
    expect(html).not.toContain("Change");
    expect(html).toContain("Locked because the tournament is live.");
  });

  it("with nothing locked it draws no banner, and the fields keep their Change", () => {
    const html = section([]);
    expect(html).not.toContain(SCOPE_LOCK_BANNER_ID);
    expect((html.match(/>Change</g) ?? []).length).toBe(2);
  });

  it("wraps the banner and does not copy its rules", () => {
    const src = readSource("src/components/setup/LockedOnce.tsx");
    expect(src).not.toMatch(/function bannerName|aria-label=\{?["']Locked/);
    expect(src).toMatch(/<ScopeLockBanner\b/);
    expect((src.match(/<ScopeLockBanner\b/g) ?? []).length).toBe(1);
  });
});
