"use client";
import type { RoundCtx } from "./use-round-ctx";

export function RoundFormatInfo({ ctx }: { ctx: RoundCtx }) {
  const { expanded, formatInfoOpen, activeFormat, description } = ctx;
  return (
    <>
{expanded && formatInfoOpen && (
        <div className="text-muted" style={{ fontSize: 13, margin: "-8px 0 0 60px", display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={{ margin: 0 }}>{description}</p>
          {/* The whole description here; its first sentence also sits under
              the Format select. */}
          {activeFormat && (
            <p style={{ margin: 0 }}>
              <b style={{ color: "var(--color-accent-200)" }}>{activeFormat.name}</b> — {activeFormat.desc}
            </p>
          )}
        </div>
      )}
    </>
  );
}
