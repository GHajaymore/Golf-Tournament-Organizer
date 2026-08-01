"use client";
import { useTransition } from "react";
import { setQualifyPerGroup } from "@/app/actions/tournament";

export function QualControl({ value }: { value: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span className="text-muted" style={{ fontSize: 12 }}>Advance per flight</span>
      <div className="seg">
        {[1, 2, 3].map((n) => (
          <label className="seg-opt" key={n}>
            <input
              type="radio"
              name="qpg"
              checked={value === n}
              disabled={pending}
              onChange={() => startTransition(() => setQualifyPerGroup(n))}
            />
            Top {n}
          </label>
        ))}
      </div>
    </div>
  );
}
