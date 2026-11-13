"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCostEntry, saveFxRate, voidCostEntry, voidFxRate } from "@/app/actions/owner-finance";

/**
 * THE FINANCE TAB'S TYPED SIDE (B44): add a cost, void a cost, type a rate. Each box is read by the
 * server's own reader (`domain/finance-input.ts`) and a refusal is said beside the button that was
 * pressed. Nothing here charges or pays anybody: it writes a record.
 */

type Option = { key: string; label: string };

const field = { display: "inline-flex", flexDirection: "column", gap: 3 } as const;
const labelStyle = { fontSize: 13, fontWeight: 600 } as const;

export function AddCostForm({ month, categories, currencies }: { month: string; categories: Option[]; currencies: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [boxes, setBoxes] = useState({ month, category: "hosting", vendor: "", currency: "USD", amount: "", cadence: "monthly", endsMonth: "", note: "" });
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof boxes) => (e: { target: { value: string } }) => setBoxes((b) => ({ ...b, [k]: e.target.value }));

  const save = () => {
    setSaid(null);
    start(async () => {
      const res = await addCostEntry(boxes);
      if (res.ok) {
        setSaid({ ok: true, text: "Cost recorded." });
        setBoxes((b) => ({ ...b, vendor: "", amount: "", note: "" }));
        router.refresh();
      } else setSaid({ ok: false, text: res.error });
    });
  };

  return (
    <section className="card elev-sm" style={{ marginBottom: 16 }} aria-label="Add a cost">
      <span className="card-title" style={{ fontSize: 15 }}>Add a cost</span>
      <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "6px 0 0" }}>
        Type what a service cost, in the currency you paid it in. A monthly or yearly cost is spread over the months it covers.
        Type 0 for a free month so it is not shown as missing.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
        <span style={field}>
          <label htmlFor="cost-month" style={labelStyle}>First month (YYYY-MM)</label>
          <input id="cost-month" className="input" value={boxes.month} onChange={set("month")} placeholder="2026-11" style={{ width: 110 }} />
        </span>
        <span style={field}>
          <label htmlFor="cost-category" style={labelStyle}>For</label>
          <select id="cost-category" className="input" value={boxes.category} onChange={set("category")}>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </span>
        <span style={{ ...field, flex: 1, minWidth: 140 }}>
          <label htmlFor="cost-vendor" style={labelStyle}>Vendor</label>
          <input id="cost-vendor" className="input" value={boxes.vendor} onChange={set("vendor")} maxLength={80} />
        </span>
        <span style={field}>
          <label htmlFor="cost-amount" style={labelStyle}>Amount</label>
          <input id="cost-amount" className="input" inputMode="decimal" value={boxes.amount} onChange={set("amount")} style={{ width: 110, fontVariantNumeric: "tabular-nums" }} />
        </span>
        <span style={field}>
          <label htmlFor="cost-currency" style={labelStyle}>Currency</label>
          <select id="cost-currency" className="input" value={boxes.currency} onChange={set("currency")}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </span>
        <span style={field}>
          <label htmlFor="cost-cadence" style={labelStyle}>Repeats</label>
          <select id="cost-cadence" className="input" value={boxes.cadence} onChange={set("cadence")}>
            <option value="once">Once</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly (amount is the year)</option>
          </select>
        </span>
        <span style={field}>
          <label htmlFor="cost-ends" style={labelStyle}>Last month <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input id="cost-ends" className="input" value={boxes.endsMonth} onChange={set("endsMonth")} placeholder="goes on" style={{ width: 110 }} />
        </span>
        <span style={{ ...field, flex: 1, minWidth: 160 }}>
          <label htmlFor="cost-note" style={labelStyle}>Note <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input id="cost-note" className="input" value={boxes.note} onChange={set("note")} maxLength={300} />
        </span>
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>Add cost</button>
      </div>
      {said && (
        <p role={said.ok ? "status" : "alert"} style={{ fontSize: 13, margin: "8px 0 0", color: said.ok ? undefined : "var(--color-danger)" }}>{said.text}</p>
      )}
    </section>
  );
}

export function VoidCostButton({ id, label, kind = "cost" }: { id: string; label: string; kind?: "cost" | "rate" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const confirm = () => {
    setError("");
    start(async () => {
      const res = kind === "rate" ? await voidFxRate(id, reason) : await voidCostEntry(id, reason);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };
  if (!open) {
    return <button type="button" className="btn btn-secondary" aria-label={`Void ${label}`} onClick={() => setOpen(true)} style={{ fontSize: 13 }}>Void</button>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <input className="input" aria-label={`Why ${label} is voided`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" maxLength={200} style={{ width: 140 }} />
      <button type="button" className="btn btn-secondary" onClick={confirm} disabled={pending} style={{ fontSize: 13 }}>Void it</button>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} style={{ fontSize: 13 }}>Keep</button>
      {error && <span role="alert" style={{ fontSize: 13, color: "var(--color-danger)" }}>{error}</span>}
    </span>
  );
}

export function RateForm({ day, currencies }: { day: string; currencies: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [boxes, setBoxes] = useState({ currency: currencies[0] ?? "GBP", day, rate: "", reason: "" });
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof boxes) => (e: { target: { value: string } }) => setBoxes((b) => ({ ...b, [k]: e.target.value }));
  const save = () => {
    setSaid(null);
    start(async () => {
      const res = await saveFxRate(boxes);
      if (res.ok) {
        setSaid({ ok: true, text: "Rate recorded." });
        setBoxes((b) => ({ ...b, rate: "", reason: "" }));
        router.refresh();
      } else setSaid({ ok: false, text: res.error });
    });
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <span style={field}>
          <label htmlFor="rate-currency" style={labelStyle}>Currency</label>
          <select id="rate-currency" className="input" value={boxes.currency} onChange={set("currency")}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </span>
        <span style={field}>
          <label htmlFor="rate-day" style={labelStyle}>From day</label>
          <input id="rate-day" className="input" value={boxes.day} onChange={set("day")} placeholder="2026-11-01" style={{ width: 120 }} />
        </span>
        <span style={field}>
          <label htmlFor="rate-value" style={labelStyle}>US dollars per 1 unit</label>
          <input id="rate-value" className="input" inputMode="decimal" value={boxes.rate} onChange={set("rate")} placeholder="1.27" style={{ width: 110 }} />
        </span>
        <span style={{ ...field, flex: 1, minWidth: 160 }}>
          <label htmlFor="rate-reason" style={labelStyle}>Where it comes from</label>
          <input id="rate-reason" className="input" value={boxes.reason} onChange={set("reason")} maxLength={200} />
        </span>
        <button type="button" className="btn btn-secondary" onClick={save} disabled={pending}>Save rate</button>
      </div>
      {said && <p role={said.ok ? "status" : "alert"} style={{ fontSize: 13, margin: "8px 0 0", color: said.ok ? undefined : "var(--color-danger)" }}>{said.text}</p>}
    </div>
  );
}
