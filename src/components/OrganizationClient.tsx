"use client";
import { useState, useRef, useTransition } from "react";
import { saveOrganizationBranding } from "@/app/actions/organization";
import {
  LOGO_ACCEPT,
  LOGO_EXT_LIST,
  LOGO_UPLOAD_TYPES,
  MAX_LOGO_BYTES,
  isDataUrl,
  dataUrlProblem,
} from "@/lib/domain/logo-upload";
import {
  brandLines,
  brandMonogram,
  isBrandDisplay,
  BRAND_DISPLAY,
  BRAND_DISPLAY_LABEL,
  BRAND_DISPLAY_HELP,
} from "@/lib/brand";
import { orgProfile, type OrgKind } from "@/lib/domain/org-profile";
import { Icon } from "./Icon";

/**
 * Load a picked file far enough to draw it.
 *
 * An `<img>` and an object URL rather than `createImageBitmap`, which is the
 * tidier API and the narrower one: this runs on whatever browser an organizer
 * happens to have, including older Safari, and a logo upload failing on a
 * decode call is a worse trade than four extra lines.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

/**
 * Ladder of encodings, widest and best first.
 *
 * A club logo is inlined into every header, board and printed scorecard, so
 * the stored string has to stay small — see MAX_LOGO_BYTES. PNG is tried at
 * three sizes BEFORE any JPEG because a logo is the one image where
 * transparency matters: dropping to JPEG puts a white box round a mark that
 * was meant to sit on the club's own colour. Only an unusually detailed image
 * gets that far, and a flat background beats a refusal.
 */
const ENCODINGS: Array<{ edge: number; type: string; quality?: number }> = [
  { edge: 512, type: "image/png" },
  { edge: 384, type: "image/png" },
  { edge: 256, type: "image/png" },
  { edge: 512, type: "image/jpeg", quality: 0.85 },
  { edge: 384, type: "image/jpeg", quality: 0.8 },
];

/** Downscale and encode until it fits the cap, or give up honestly. */
function shrink(img: HTMLImageElement): string | null {
  for (const { edge, type, quality } of ENCODINGS) {
    const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    const encoded = canvas.toDataURL(type, quality);
    // A browser that cannot encode the type asked for silently returns PNG,
    // so check what came back rather than what was requested.
    if (encoded.length <= MAX_LOGO_BYTES) return encoded;
  }
  return null;
}

/**
 * A name of the right SHAPE for each kind, for the placeholder.
 *
 * Keyed off `OrgKind` so the compiler asks for one when a kind is added —
 * the same reason the profile table itself is a `Record<OrgKind, ...>`.
 */
const NAME_EXAMPLE: Record<OrgKind, string> = {
  club: "Ridgeline National Golf Club",
  community: "Thursday Society",
  personal: "Sunday Golf",
};

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
  /** Why the picked file was refused. Separate from `error`, which is the SAVE
   *  failing — a rejected upload has changed nothing and saved nothing. */
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
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
  const uploaded = isDataUrl(logoUrl);

  /**
   * Take a picked file, shrink it, and put it where the URL used to go.
   *
   * The file never leaves the browser as a file — it is resized and encoded
   * here, and what reaches the server is the same `logoUrl` string the URL
   * field has always produced. That is what makes this a small change rather
   * than an upload pipeline: no route, no bucket, no signed URL, and every
   * reader of the column untouched.
   *
   * The checks are duplicated on the server on purpose, not by oversight —
   * `saveOrganizationBranding` is a public endpoint. These exist to tell the
   * organizer WHICH file was wrong while they are still looking at the picker.
   */
  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError("");
    setSaved(false);

    if (!LOGO_UPLOAD_TYPES.some((t) => t.mime === file.type)) {
      setUploadError(`That file is not a ${LOGO_EXT_LIST} image.`);
      return;
    }

    try {
      const img = await loadImage(file);
      const encoded = shrink(img);
      if (!encoded) {
        setUploadError(
          "That image is too detailed to store inline. Try a simpler or smaller one, or paste an https:// link to it.",
        );
        return;
      }
      // The same rule the server will apply, run here so a refusal names the
      // file rather than arriving as a failed save.
      const problem = dataUrlProblem(encoded);
      if (problem) {
        setUploadError(problem);
        return;
      }
      setLogoUrl(encoded);
    } catch {
      setUploadError("That file could not be read as an image.");
    }
  };

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
        {/* Named for what this outfit ACTUALLY IS. The card immediately below
            already reads "Personal · a single organizer" off the same profile,
            so a heading hard-coded to "Club settings" made the page disagree
            with itself in one eyeful. */}
        <h1 className="page-title">{orgProfile(props.kind).settingsLabel}</h1>
        {/* Described the branding card and nothing else, on a page that also
            holds the theme, the house play settings, the money default and
            staff access. An intro naming one of five cards reads as a
            description of the page. */}
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Everything here applies to every tournament this organization runs — the branding on the console
          header and printed scorecards, the look, how money works by default, and who has access.
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
          {/* A kicker, not a card title, so it names the section it heads
              rather than the whole card — the card also holds "Where the club
              is", which is not branding. Same treatment as the sections on
              Tournament details. */}
          <span className="card-kicker">Branding</span>

          <div className="field">
            <label>Organization name</label>
            <input
              className="input"
              value={name}
              disabled={!props.canEdit || pending}
              onChange={(e) => setName(e.target.value)}
              // An example of the kind of outfit this actually is. "e.g.
              // Ridgeline National Golf Club" is the one thing on the field a
              // solo organizer knows they are not.
              placeholder={`e.g. ${NAME_EXAMPLE[orgProfile(props.kind).kind]}`}
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
              Logo <span className="text-muted">· upload a file, or link to one</span>
            </label>

            {/* An UPLOADED logo is held in the same field as a URL, so the box
                would otherwise show a quarter of a megabyte of base64. Nobody
                needs to read that, and it cannot be usefully edited — so an
                upload gets its own row saying what it is, with the way back
                out beside it. */}
            {uploaded ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  border: "1px solid var(--color-divider)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                {
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt=""
                    style={{ height: 26, width: "auto", maxWidth: 90, objectFit: "contain", flex: "none" }}
                  />
                }
                <span style={{ fontSize: 13, minWidth: 0 }}>
                  Uploaded image
                  <span className="text-muted"> · {Math.round(logoUrl.length / 1024)}KB</span>
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginLeft: "auto", fontSize: 12 }}
                  disabled={!props.canEdit || pending}
                  onClick={() => {
                    setLogoUrl("");
                    setUploadError("");
                  }}
                >
                  <Icon name="x" /> Remove
                </button>
              </div>
            ) : (
              <input
                className="input"
                value={logoUrl}
                disabled={!props.canEdit || pending}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {/* The input itself is hidden because the native control renders
                  differently on every platform and none of them match the rest
                  of this form. The button drives it, which keeps the file
                  picker native where it matters. */}
              <input
                ref={fileRef}
                type="file"
                accept={LOGO_ACCEPT}
                hidden
                onChange={(e) => {
                  void pickFile(e.target.files?.[0]);
                  // Cleared so picking the SAME file again still fires a
                  // change event — otherwise a retry after a failed upload
                  // does nothing at all.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!props.canEdit || pending}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="upload-simple" /> {uploaded ? "Replace image" : "Upload an image"}
              </button>
              <span className="text-muted" style={{ fontSize: 12 }}>
                {LOGO_EXT_LIST}, up to {Math.round(MAX_LOGO_BYTES / 1024)}KB
              </span>
            </div>

            {uploadError && (
              <p style={{ fontSize: 12, margin: "8px 0 0", color: "var(--color-danger)" }}>
                <Icon name="warning-circle" /> {uploadError}
              </p>
            )}

            <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
              Upload a {LOGO_EXT_LIST} file and it is resized and kept here, so it works for players and
              on printed scorecards without depending on another website. Or, if your logo is already
              online, right-click it there and paste the image address above — an SVG works that way too.
              A square or wide transparent PNG looks best.
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
                  {preview.primary || (
                    <span className="text-muted">Your {orgProfile(props.kind).noun}</span>
                  )}
                </span>
                {preview.secondary && (
                  <span style={{ fontSize: 10.5, color: "var(--color-neutral-500)" }}>{preview.secondary}</span>
                )}
              </span>
            </div>
          </div>

          {/* "Not branding" — the comment here said exactly that, while the
              block sat under a heading reading "Branding" and under a page
              blurb promising branding applies to "the console header and
              printed scorecards and reports". The club's address does none of
              those things: it prefills a new course's city and scopes the
              course search, so an organizer adding a card is not typing their
              own town every time.

              A heading of its own, and the label is dropped rather than
              repeated under it — one control, so the heading IS the label. The
              three inputs keep their own aria-labels. */}
          <span
            className="card-kicker"
            style={{ marginTop: 8, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}
          >
            {/* NOT "where the club is". A society has no address and a solo
                organizer certainly does not, and the help below says what this
                is actually for: prefilling the city when a course is added.
                Phrased for what it does, which is true of all three kinds. */}
            Where you play <span className="text-muted">· optional</span>
          </span>
          <div>
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
              <Icon name="warning-circle" /> {error}
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
              <Icon name="warning" /> {warning}
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
              <Icon name="check" /> {pending ? "Saving…" : saved && !dirty ? "Saved" : "Save changes"}
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
          {/* Reads `brandLines` and `brandMonogram`, the same helpers the
              sidebar itself uses — and the same ones the preview beside the
              toggle uses.

              This card used to re-implement both by hand: `shortName || name`
              for the text, which IGNORES the "Name beside the logo" setting
              three inches to its left, and `charAt(0)` for the monogram, where
              `brandMonogram` keeps an all-caps short name whole ("CDG", not
              "C") and takes two initials from two words. So a club set to show
              its full name saw the short one here, and "Ridgeline National"
              previewed as "RN" in one box and "R" in the other. Two previews of
              one header, disagreeing, on the screen whose whole job is showing
              a club what its header looks like. */}
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
                  fontSize: brandMonogram(name, shortName).length > 1 ? 11 : 13,
                  fontWeight: 600,
                }}
              >
                {brandMonogram(name, shortName)}
              </div>
            )}
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 15 }}>
                {preview.primary || "Your organization"}
              </span>
              {preview.secondary && (
                <span style={{ fontSize: 10.5, color: "var(--color-neutral-500)" }}>{preview.secondary}</span>
              )}
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
