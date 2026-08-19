"use client";
import { useState, useTransition } from "react";
import { saveOrganizationBranding } from "@/app/actions/organization";
import {
  brandLines,
  brandMonogram,
  isBrandDisplay,
  BRAND_DISPLAY,
  BRAND_DISPLAY_LABEL,
  BRAND_DISPLAY_HELP,
} from "@/lib/brand";
import { orgProfile } from "@/lib/domain/org-profile";

interface Props {
  name: string;
  shortName: string;
  logoUrl: string;
  city: string;
  region: string;
  country: string;
  brandDisplay: string;
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
  const [city, setCity] = useState(props.city);
  const [region, setRegion] = useState(props.region);
  const [country, setCountry] = useState(props.country);
  const [brandDisplay, setBrandDisplay] = useState(props.brandDisplay);
  const [error, setError] = useState("");
  /** Saved, but the logo couldn't be reached from our server. */
  const [warning, setWarning] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty =
    name !== props.name ||
    shortName !== props.shortName ||
    logoUrl !== props.logoUrl ||
    city !== props.city ||
    region !== props.region ||
    country !== props.country ||
    brandDisplay !== props.brandDisplay;

  const preview = brandLines(name, shortName, isBrandDisplay(brandDisplay) ? brandDisplay : "short");

  const save = () => {
    setError("");
    setWarning("");
    setSaved(false);
    startTransition(async () => {
      const result = await saveOrganizationBranding(name, shortName, logoUrl, { city, region, country }, brandDisplay);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save.");
        return;
      }
      setWarning(result.warning ?? "");
      setSaved(true);
    });
  };

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Club settings</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Branding here applies to every tournament this organization runs — the console header and printed
          scorecards and reports.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Type</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>{orgProfile(props.kind).label}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {orgProfile(props.kind).sharedRoster ? "shared with staff" : "a single organizer"}
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

      <div className="page-split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>
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

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>Name beside the logo</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {BRAND_DISPLAY.map((k) => {
                const on = brandDisplay === k;
                return (
                  <button
                    key={k}
                    type="button"
                    className="btn"
                    disabled={!props.canEdit || pending}
                    onClick={() => setBrandDisplay(k)}
                    title={BRAND_DISPLAY_HELP[k]}
                    style={{
                      border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                      color: on ? "var(--color-accent)" : "var(--color-text)",
                    }}
                  >
                    {BRAND_DISPLAY_LABEL[k]}
                  </button>
                );
              })}
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
              {BRAND_DISPLAY_HELP[(BRAND_DISPLAY as readonly string[]).includes(brandDisplay)
                ? (brandDisplay as (typeof BRAND_DISPLAY)[number])
                : "short"]}
            </p>
            {/* A live preview, because nobody can picture three renderings of
                their own club name from a label. Shows the same fallbacks the
                sidebar uses, so an empty short name looks here exactly as it
                will there. */}
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--color-bg)",
                boxShadow: "inset 0 0 0 1px var(--color-divider)",
              }}
            >
              {logoUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" style={{ height: 28, width: "auto", maxWidth: 110, objectFit: "contain" }} />
              ) : (
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    display: "grid",
                    placeItems: "center",
                    background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
                    color: "var(--color-accent)",
                    fontSize: brandMonogram(name, shortName).length > 1 ? 11 : 15,
                    fontWeight: 600,
                  }}
                >
                  {brandMonogram(name, shortName)}
                </span>
              )}
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}>
                  {preview.primary || <span className="text-muted">Your club</span>}
                </span>
                {preview.secondary && (
                  <span style={{ fontSize: 10.5, color: "var(--color-neutral-500)" }}>{preview.secondary}</span>
                )}
              </span>
            </div>
          </div>

          {/* Where the club is. Not branding — it prefills a new course's city
              and scopes the course search, so an organizer adding a card is not
              typing their own town every time. */}
          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Where the club is <span className="text-muted">· optional</span>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <input
                className="input"
                value={city}
                disabled={!props.canEdit || pending}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                aria-label="City"
              />
              <input
                className="input"
                value={region}
                disabled={!props.canEdit || pending}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="State or region"
                aria-label="State or region"
              />
              <input
                className="input"
                value={country}
                disabled={!props.canEdit || pending}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Country"
                aria-label="Country"
              />
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              Used to prefill the city when you add a course, so local courses don&rsquo;t need retyping.
            </p>
          </div>

          {error && (
            <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {error}
            </p>
          )}

          {warning && (
            <p
              style={{
                fontSize: 13,
                margin: 0,
                padding: "9px 11px",
                borderRadius: "var(--radius-md)",
                background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
            >
              <i className="ph ph-warning" /> {warning}
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
