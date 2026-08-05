"use client";
import { useState, useTransition } from "react";
import { saveOrganizationBranding } from "@/app/actions/organization";

interface Props {
  name: string;
  shortName: string;
  logoUrl: string;
  kind: string;
  plan: string;
  eventCount: number;
  memberCount: number;
  canEdit: boolean;
}

export function OrganizationClient(props: Props) {
  const [name, setName] = useState(props.name);
  const [shortName, setShortName] = useState(props.shortName);
  const [logoUrl, setLogoUrl] = useState(props.logoUrl);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = name !== props.name || shortName !== props.shortName || logoUrl !== props.logoUrl;

  const save = () => {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await saveOrganizationBranding(name, shortName, logoUrl);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save.");
        return;
      }
      setSaved(true);
    });
  };

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Organization</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Branding here applies to every tournament this organization runs — the console header and printed
          scorecards and reports.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Type</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>
            {props.kind === "club" ? "Club" : "Personal"}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {props.kind === "club" ? "shared with staff" : "a single organizer"}
          </div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Plan</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, textTransform: "capitalize" }}>{props.plan}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>players are always unlimited</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Tournaments</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{props.eventCount}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>owned by this organization</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Staff</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{props.memberCount}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>organizers &amp; assistants</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm" style={{ gap: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Branding</span>

          <div className="field">
            <label>Organization name</label>
            <input
              className="input"
              value={name}
              disabled={!props.canEdit || pending}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ridgeline National Golf Club"
            />
          </div>

          <div className="field">
            <label>
              Short name <span className="text-muted">· optional, used in tight spaces</span>
            </label>
            <input
              className="input"
              value={shortName}
              disabled={!props.canEdit || pending}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="e.g. Ridgeline"
            />
          </div>

          <div className="field">
            <label>
              Logo URL <span className="text-muted">· https:// link to an image</span>
            </label>
            <input
              className="input"
              value={logoUrl}
              disabled={!props.canEdit || pending}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://yourclub.com/logo.png"
            />
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              Most clubs already host a logo on their website — right-click it there and copy the image
              address. A square or wide transparent PNG works best. Direct file upload needs storage that
              isn&rsquo;t set up yet.
            </p>
          </div>

          {error && (
            <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger, #e0665a)" }}>
              <i className="ph ph-warning-circle" /> {error}
            </p>
          )}

          {props.canEdit ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ alignSelf: "flex-start" }}
              disabled={pending || !dirty}
              onClick={save}
            >
              <i className="ph ph-check" /> {pending ? "Saving…" : saved && !dirty ? "Saved" : "Save changes"}
            </button>
          ) : (
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Only an organization owner or admin can change these settings.
            </p>
          )}
        </div>

        <div className="card elev-sm" style={{ gap: 10 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Preview</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "-4px 0 0" }}>
            How the header will look.
          </p>
          <div
            style={{
              border: "1px solid var(--color-divider)",
              borderRadius: "var(--radius-md)",
              padding: "12px 14px",
              background: "var(--color-bg)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                style={{ height: 28, width: "auto", maxWidth: 120, objectFit: "contain" }}
              />
            ) : (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  display: "grid",
                  placeItems: "center",
                  background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
                  color: "var(--color-accent)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {(shortName || name || "?").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 15 }}>
              {shortName || name || "Your organization"}
            </span>
          </div>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            If the logo doesn&rsquo;t appear, the URL may point at a page rather than an image file, or the
            host may block hotlinking.
          </p>
        </div>
      </div>
    </>
  );
}
