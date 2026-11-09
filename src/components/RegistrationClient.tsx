"use client";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import { useGolfTerms } from "@/components/GolfTermsProvider";
import { toCsv } from "@/lib/domain/csv-export";
import { entriesOpen, overCapacity, suggestedInvite } from "@/lib/registration";
import { dayAsDate } from "@/lib/deadline";
import { parseHandicapInput, STAFF_HANDICAP_REFUSAL } from "@/lib/domain/registration-intake";
import { promotionState } from "@/lib/domain/promotion";
import { setRequirePhone, approveSignup, rotatePublicToken } from "@/app/actions/tournament";
import { Fragment, useId, useState, useRef, useEffect, useTransition, useSyncExternalStore, useOptimistic } from "react";
import { setPlayerIndex, indexChangeFacts } from "@/app/actions/player-index";
import { addSignup, removeSignup, removeSignups, updateSignup, importCsvSignups, previewCsvSignups, setInviteMessage, placeInFlight, type CsvImportResult, type CsvPreviewRow } from "@/app/actions/tournament";
import {
  CHECK_WORDS,
  CODES_TURNED_ON,
  CSV_STANDING_GUIDE,
  CSV_TEMPLATE_HEADER,
  ENTRY_STANDINGS,
  GUEST_EMAIL_DROPPED,
  NO_EMAIL_YET,
  STANDING_CHOICE,
  STANDING_TAG,
  entryStanding,
  importButtonWords,
  guestCodesNote,
  isGuest,
  memberWithoutEmail,
  previewSummary,
  standingHint,
  type EntryStanding,
} from "@/lib/domain/entry-standing";
import { withdrawConfirmation, type FieldChange } from "@/lib/domain/field-change";
import { setNameWithheld } from "@/app/actions/report-settings";
import { SaveState, useSaveStatus } from "./SaveState";
import { ScopeLockBanner } from "./ScopeLockBanner";
import { useCaughtUp } from "./useAction";
import type { CorrectionFacts, ScopeLock } from "@/lib/domain/tournament-status";
import { RosterPicker } from "./RosterPicker";
import type { RosterCandidate } from "@/lib/services/roster";
import { csvSizeRefusal } from "@/lib/csv";
import { playerTeeCounts } from "@/lib/tournament-settings";
import { contactGaps } from "@/lib/domain/contact-gaps";
import { setPlayerTee } from "@/app/actions/courses";
import { ConfirmButton } from "./ConfirmButton";
import { indexLabel, indexFigure } from "@/lib/domain/handicap-label";
import { Icon } from "./Icon";
import { SignUpPoster } from "./SignUpPoster";
import { EntryTermsCard } from "./EntryTermsCard";
import { MoreInfo } from "./MoreInfo";
import { leaveOnEnter } from "@/lib/leave-on-enter";
import { bringIntoView } from "@/lib/bring-into-view";
import { EMAIL_MAX, PERSON_NAME_MAX, PHONE_MAX, PLACE_MAX } from "@/lib/domain/typed-limits";
import { HANDICAP_BODIES, bodyInProse, bodyShortLabel, handicapBody as bodyById } from "@/lib/domain/handicap-body";

/** Each field change's refusal, or null where it is open (`fieldDoors`). */
export type FieldDoors = Record<FieldChange, string | null>;

/** The page's origin never changes while it is open, so nothing to subscribe to. */
const noSubscription = () => () => {};

interface Signup {
  /** The set this entry plays from. Null means the round’s own. */
  teeId?: string | null;
  /** The tees this player plays with no set of their own, and why — e.g. "Red (ladies')". */
  inheritedTee?: string;
  id: string;
  name: string;
  handicap: number;
  handicapType?: string;
  /**
   * ghin | manual | none. "none" is nobody having claimed a figure, which is
   * NOT a scratch handicap — see `indexLabel`, which is the only thing allowed
   * to turn these two fields into words.
   */
  handicapSource?: string;
  seed: number;
  email?: string;
  phone?: string;
  /** The club a visitor plays from, as the Add form took it. "" for none. */
  homeClub?: string;
  flight?: string;
  /** ISO string, set only for entries promoted off the waitlist. */
  promotedAt?: string | null;
  /** "Don't show my name on public pages": signed out, they are "Player (name withheld)". */
  publicNameWithheld?: boolean;
  /** As stored (`Player.standing`); read only through `entryStanding`. */
  standing?: string;
}
interface EventInfo {
  name: string;
  /** The places this tournament really holds: the stored number under the plan's field cap. */
  capacity: number;
  /** The number the organizer set (0 = open), for the terms form — not capped by the plan. */
  storedCapacity?: number;
  /** The plan's field limit where one is enforced, else null. */
  planLimit?: number | null;
  /** draft | registration | ready | live | completed — a finished tournament
   *  takes no more entries, whatever the switch and the deadline say. */
  status: string;
  regDeadline: string;
  /** First day entries are taken, or "" — see `Event.regOpens`. */
  regOpens: string;
  /** Organizer overriding the deadline: null follows it, true closes, false extends. */
  registrationOverride: boolean | null;
  inviteMessage: string;
  /** Owning club's name, used to sign invitations. */
  organizationName?: string;
  dates: string;
  course: string;
  city: string;
  /** Self-service registration: whether the public link is live. */
  registrationOpen: boolean;
  /** auto | approve — whether entries land confirmed or wait for the organizer. */
  registrationApproval: string;
  /** The organizer's own per-tournament choice, on every plan — `phoneRequiredFor`. */
  requirePhone: boolean;
  /** Opaque token for the public /register/[token] link. Empty until first opened. */
  registrationToken: string;
  /** How this tournament writes a date — the deadline reads like the event's own date. */
  locale?: string;
  /**
   * Today AT THE CLUB, yyyy-mm-dd, from the server (`state.today`).
   *
   * This screen worked out "Open" or "Closed" from the clock of whatever was
   * drawing it — the server, then the organizer's browser — so the two could
   * disagree for the hours either side of a midnight, and neither was the
   * club's day. Required, so a caller cannot leave it to a clock again.
   */
  today: string;
}

export function RegistrationClient({
  event,
  confirmed,
  waitlist,
  pendingEntries,
  locked,
  fieldLocks = [],
  correction = null,
  doors,
  underWay = null,
  flights = [],
  unplacedFlag = "",
  addFlight = null,
  offerReserve = false,
  isAdmin,
  roster,
  tees = [],
  teePolicy = "own",
  defaultTeeName = "",
  needsEmail = true,
  noFormatYet = false,
  handicapBody = { id: "ghin", label: "GHIN", prose: "GHIN", number: "GHIN number" },
}: {
  /**
   * The club's handicap body in this form's words (`domain/handicap-body.ts`):
   * its id, the choice beside Manual and None, the body in a sentence, and
   * what a member's number with it is called.
   */
  handicapBody?: { id: string; label: string; prose: string; number: string };
  /** No round yet and nobody entered: a society taking entries before it chooses a format. */
  noFormatYet?: boolean;
  event: EventInfo;
  /**
   * Whether this tournament's sign-in actually needs an address — see
   * `entryNeedsEmail`.
   *
   * The field was marked "required, grants sign-in" and its Add button was
   * disabled without one, on every tournament, including the society and
   * charity templates that ship Round Codes precisely so a names-only roster
   * can play. Defaults to true so a caller that has not been taught asks for
   * exactly what it asked for before.
   */
  needsEmail?: boolean;
  confirmed: Signup[];
  /**
   * The sets this course is rated for, and which the round uses.
   *
   * Empty, or a single-tee competition, and the column is not shown: a
   * per-player choice under "one set for everyone" would be a control that
   * contradicts the rule the committee set.
   */
  tees?: Array<{ id: string; name: string }>;
  teePolicy?: string;
  defaultTeeName?: string;
  waitlist: Signup[];
  /** Self-service entries awaiting the organizer's approval (approve mode). */
  pendingEntries: Signup[];
  /** The FIELD's lock (the machine's `locks.field`, PR 5b) — the per-player tees, the entry terms. The field has its own doors below. */
  locked: boolean;
  /** The same lock as the banner draws it, with its reason and way out, and the committee correction open on it, if any. */
  fieldLocks?: readonly ScopeLock[];
  correction?: CorrectionFacts | null;
  /**
   * THE FIELD'S DOORS (day-of field changes, PR A): each field change's refusal
   * in a sentence, or null where it is open — `fieldDoors` of the one rule the
   * actions ask (`domain/field-change.ts`). After launch Withdraw, Put back and
   * (in stroke play, Stableford and a league, before play) Add stay open while
   * setup is locked; the CSV import, bulk delete and details stay shut.
   */
  doors: FieldDoors;
  /** The under-way banner (`fieldBanner`), shown in place of "Setup locked"; null when not under way. */
  underWay?: string[] | null;
  /** The flights a late entrant may be placed in, labelled as the field table labels them. */
  flights?: Array<{ id: string; label: string }>;
  /** Who is in the field but in no flight, in the panel's words (`unplacedWords`); "" for nobody (J04). */
  unplacedFlag?: string;
  /** The add form's flight (`addFlightPick`): offered, required (a launched round robin), or not drawn. */
  addFlight?: "offered" | "required" | null;
  /** A knockout whose draw is made takes a reserve on the waiting list instead (`reserveOffered`). */
  offerReserve?: boolean;
  isAdmin: boolean;
  /** The club's members, for filling the field without retyping anyone. */
  roster: RosterCandidate[];
}) {
  // A society is not a club, and this screen says so. See OrgProfileProvider.
  const org = useOrgProfile();
  /**
   * Whether the two self-service panels are open.
   *
   * Open when the public link is actually published, shut when it is not.
   * That is a fact about how this tournament takes entries rather than a
   * guess about who is looking at the screen: a society running public
   * sign-ups finds the panels already open every time, and a club secretary
   * who has never published a link never scrolls past them.
   */
  const [selfServeOpen, setSelfServeOpen] = useState(event.registrationOpen);
  // Opening entries publishes the link: show it where it appears, without a second press to find it.
  useEffect(() => {
    if (event.registrationOpen) setSelfServeOpen(true);
  }, [event.registrationOpen]);
  const [name, setName] = useState("");
  // Member or Guest (not a club member), the organizer's choice (Ajay, 2026-11-07).
  const [standing, setStanding] = useState<EntryStanding>("member");
  const addingGuest = standing === "guest";
  // The hint's {club}: the club's own name where the page has it.
  const golfWords = useGolfTerms();
  const hint = standingHint(event.organizationName ?? "", golfWords);
  // The CSV preview ("Check the list"): the file's text, what each row will be, and the organizer's switches.
  const [preview, setPreview] = useState<{ csv: string; rows: CsvPreviewRow[] } | null>(null);
  const [choices, setChoices] = useState<Record<number, EntryStanding>>({});
  // The "Add someone new" captions are real <label>s for their controls.
  const fid = useId();
  const [handicap, setHandicap] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [ghin, setGhin] = useState("");
  // A visitor's own body ("" = the club's). Their index is their body's
  // official figure under WHS, and the number box takes their body's words.
  const [visitorBody, setVisitorBody] = useState("");
  const [visitorOpen, setVisitorOpen] = useState(false);
  const theirBody = bodyById(visitorBody);
  const bodyWords = theirBody
    ? { label: bodyShortLabel(theirBody), prose: bodyInProse(theirBody), number: theirBody.number }
    : handicapBody;
  const [homeClub, setHomeClub] = useState("");
  const [hSource, setHSource] = useState("manual");
  const [invite, setInvite] = useState(event.inviteMessage);
  const [copied, setCopied] = useState("");
  const [newHandicapType, setNewHandicapType] = useState("18");
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [addError, setAddError] = useState("");
  /**
   * A refused edit, and the player row it was made on — said under THAT row
   * (the text-box crawl, 2026-10-21: a bad address typed on one row was refused
   * at the head of the lists, out of sight of a long field). No row: said at the head.
   */
  const [rowSaid, setRowSaid] = useState<{ text: string; at: string }>({ text: "", at: "" });
  const rowError = rowSaid.text;
  const setRowError = (text: string, at = "") => setRowSaid({ text, at: text ? at : "" });
  const [pending, startTransition] = useTransition();
  const caughtUp = useCaughtUp();
  const tableSaveStatus = useSaveStatus(pending);
  // The invite message saves when it is left, on its own transition so its
  // "Saved" does not light up for a change made somewhere else on the screen.
  const [invitePending, startInviteSave] = useTransition();
  const inviteSaveStatus = useSaveStatus(invitePending);
  const savedInvite = useRef(event.inviteMessage);
  /**
   * A TAP SHOWS AT ONCE. Both switches were drawn straight from the server's
   * value, so a tick did nothing on screen until the save came back and the page
   * was drawn again — next door to the server a blink, on a course seconds of a
   * box that ignores the thumb (found 2026-10-16 by the browser test of this
   * switch, whose `check()` saw the box unchanged). The shown value follows the
   * tap while the save is out, and falls back to the server's if it is refused.
   */
  const [requirePhoneShown, showRequirePhone] = useOptimistic(event.requirePhone);
  /** A refused switch, said beside the switches — see the handlers. */
  const [switchRefused, setSwitchRefused] = useState("");
  const [approvalShown, showApproval] = useOptimistic(event.registrationApproval);
  // What the import and the public form will actually insist on — the page
  // hands down `phoneRequiredFor`'s answer, so the hint can't promise something
  // the action then refuses.
  const phoneRequired = event.requirePhone;
  /**
   * A HANDICAP TYPED HERE CHANGES THIS TOURNAMENT'S COPY, AND ASKS ABOUT MEMBERS
   * (2026-10-16). It went through `updateSignup`, which pushed every edit on to
   * the member record without a word or a line in the history, and was greyed
   * out by the setup lock exactly when a committee cuts a handicap mid-event.
   * Now it is `setPlayerIndex` — the one door the round's "Change" uses too —
   * and where Members still holds the old figure, the row offers the correction
   * in one tap (the tournament director on the review panel: a typo is wrong
   * everywhere, so the offer is made, not left to be found).
   */
  const [memberOffer, setMemberOffer] = useState<{ playerId: string; name: string; to: number; memberFrom: number; done?: string } | null>(null);
  const commitIndex = (p: { id: string; name: string; handicap: number }, value: number) =>
    startTransition(async () => {
      const res = await setPlayerIndex(p.id, { index: value, expectedFrom: p.handicap, alsoMember: false, reason: "" });
      if (!res.ok) {
        setRowError(`${p.name}: ${res.error ?? "Couldn't save that handicap."}`, p.id);
        return;
      }
      setRowError("");
      const facts = await indexChangeFacts(p.id);
      setMemberOffer(
        facts.ok && !facts.memberRefusal && facts.memberFrom != null && facts.memberFrom !== value
          ? { playerId: p.id, name: p.name, to: value, memberFrom: facts.memberFrom }
          : null,
      );
    });
  const pushToMembers = (offer: { playerId: string; name: string; to: number; memberFrom: number }) =>
    startTransition(async () => {
      const res = await setPlayerIndex(offer.playerId, {
        index: offer.to,
        expectedFrom: offer.to,
        alsoMember: true,
        reason: "Correction on Entries",
      });
      if (!res.ok) {
        setRowError(`${offer.name}: ${res.error ?? "Couldn't change Members."}`, offer.playerId);
        return;
      }
      setMemberOffer({ ...offer, done: `Done. Members has ${indexFigure(offer.to)} for ${offer.name} now.` });
    });
  const commitUpdate = (playerId: string, patch: Parameters<typeof updateSignup>[1]) =>
    startTransition(async () => {
      const result = await updateSignup(playerId, patch);
      setRowError(result.ok ? "" : result.error ?? "Couldn't save that change.", playerId);
    });
  // Its own action rather than updateSignup: a tee is scoped to the club’s
  // courses and checked against them, which updateSignup has no business
  // knowing about.
  const commitTee = (playerId: string, teeId: string | null) =>
    startTransition(async () => {
      const result = await setPlayerTee(playerId, teeId);
      setRowError(result.ok ? "" : result.error ?? "Couldn’t save those tees.", playerId);
    });
  /**
   * Shown only when there is a real per-player choice to make.
   *
   * Under "one" the whole field plays the round’s set, so a per-player
   * dropdown would be a control contradicting the condition the committee
   * set — and one somebody would use, believing it.
   *
   * And under "each flight plays its own tees", for the same reason: this
   * asked for anything but "one", so by division the dropdown was drawn,
   * saved, and stepped past by the scorer. `playerTeeCounts` is the scorer's
   * own answer.
   */
  const showTees = tees.length > 0 && playerTeeCounts(teePolicy);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const unlimited = event.capacity <= 0;
  // And the other side of that clamp — see `overCapacity`.
  const over = overCapacity(event.capacity, confirmed.length);
  // Was computed from capacity alone, so a tournament whose deadline passed a
  // week ago still read "Open · unlimited" — the screen stating something
  // false about the organizer's own event.
  const entries = entriesOpen({
    registrationOpen: event.registrationOpen,
    eventStatus: event.status,
    deadline: event.regDeadline,
    opens: event.regOpens,
    capacity: event.capacity,
    confirmedCount: confirmed.length,
    override: event.registrationOverride,
    now: dayAsDate(event.today),
    locale: event.locale,
  });
  const reg = entries.status;
  // Both halves of the same rule, reported together — see contactGaps for why
  // the phone line is conditional, and why it says outright that the existing
  // entries are not a mistake.
  // `needsEmail` is `entryNeedsEmail`, which this component already had and did
  // not pass on — so the email line asserted "access is email-based" about a
  // tournament signing players in by Round Code, where it is false. The field
  // input one screen down already says the opposite: "optional — they sign in
  // with the Round Code".
  // A guest has no email and no mobile by the ruling, so neither is a gap (2026-11-07).
  const gaps = contactGaps([...confirmed, ...waitlist].filter((p) => !isGuest(p)), phoneRequired, needsEmail);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSelectAll = (rows: Signup[]) =>
    setSelected((prev) => {
      const allSelected = rows.every((r) => prev.has(r.id));
      const next = new Set(prev);
      for (const r of rows) {
        if (allSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  /**
   * Delete the selected rows OF THIS TABLE.
   *
   * One `selected` Set is shared by the confirmed, waitlist and pending tables
   * — which is fine, ids are unique — but this used to delete every id in it
   * while the button counted only the rows in front of you. Tick three
   * confirmed and two waitlisted, press "Delete 2 selected", and all five went,
   * with no confirmation and no undo. The rows are the ones the label counted.
   */
  const deleteSelected = (rows: Signup[]) => {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    const names = ids.map((id) => rows.find((r) => r.id === id)?.name ?? "").filter(Boolean);
    // Deleting a signup can end someone's tournament. It is worth a sentence.
    if (!window.confirm(`Remove ${names.length === 1 ? names[0] : `${names.length} players`} from this tournament?\n\nAnyone who has already played is withdrawn instead, so their results stay.`)) {
      return;
    }
    startTransition(async () => {
      const res = await removeSignups(ids);
      if (res.error) {
        setRowError(res.error);
        return;
      }
      setRowError(
        res.withdrawn
          ? `${res.withdrawn} ${res.withdrawn === 1 ? "player has" : "players have"} played, so ${res.withdrawn === 1 ? "that entry was" : "those entries were"} withdrawn rather than deleted — their results are kept.`
          : "",
      );
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  /**
   * WHAT A FIELD CHANGE LEFT TO DO, said where the field is (day-of field
   * changes, PR A): "Pat moved in from the waiting list. Pat has no tee time
   * yet", "Sam is in no flight". A refusal is said the same way, in the rule's words.
   */
  const [fieldSaid, setFieldSaid] = useState("");
  const withdraw = (p: Signup) =>
    startTransition(async () => {
      const res = await removeSignup(p.id);
      if (!res.ok) {
        // Under the row in the field or the waiting list; at the head for an entry awaiting approval.
        const inATable = confirmed.some((r) => r.id === p.id) || waitlist.some((r) => r.id === p.id);
        setRowError(`${p.name}: ${res.error}`, inATable ? p.id : "");
        return;
      }
      setRowError("");
      setFieldSaid(res.said);
    });
  const place = (p: Signup, groupId: string) =>
    startTransition(async () => {
      const res = await placeInFlight(p.id, groupId);
      setRowError(res.ok ? "" : `${p.name}: ${res.error ?? "That did not save."}`, p.id);
      if (res.ok) setFieldSaid("");
    });

  /**
   * THE ADD FORM'S FLIGHT (panel Q3, PR 7a): offered in stroke play and
   * Stableford, required in a launched round robin. With one chosen the press
   * is a late entry WITH a flight, and the door it asks is that one.
   */
  const [addFlightId, setAddFlightId] = useState("");
  const addRefusal = addFlight && addFlightId ? doors["add-to-flight"] : doors.add;
  const submitAdd = (reserve = false) => {
    /**
     * THE THIRD PLACE THIS RULE WAS WRITTEN, and the one that made relaxing
     * the other two look like it had not worked.
     *
     * The server was taught to ask the tournament, the label was taught, the
     * Add button was taught — and this early return still refused the entry
     * before the action was ever called. Walked on 2026-09-11 on a charity day
     * with Round Codes: the field read "Email · optional", the button was
     * enabled, and clicking it produced "Email is required".
     *
     * A client-side copy of a server rule is the shape that guarantees this:
     * it cannot be caught by a test of the action, and it fails in the one
     * direction nobody checks, by refusing rather than admitting.
     *
     * And since 2026-11-07 there is no email rule to copy: a member may be
     * added without one and a guest needs none (the action turns Round Codes
     * on where they are needed).
     */
    if (!name.trim()) {
      setAddError("Enter a player name.");
      return;
    }
    // The same reading as the public form and both importers: "+2.4" is a plus
    // handicap, 2.4 better than scratch, and parseFloat gets that backwards.
    const h = parseHandicapInput(handicap);
    if (!h.ok) {
      // In the organizer's words: `h.error` is written to a player about their own handicap.
      setAddError(STAFF_HANDICAP_REFUSAL[h.why]);
      return;
    }
    setAddError("");
    startTransition(async () => {
      const result = await addSignup({
        name,
        // An empty box goes as empty. `parseHandicapInput` reads it as "no
        // handicap" and hands back 0 for the arithmetic; sending that 0 on
        // made every blank a scratch golfer entered by hand.
        handicap: h.source === "none" ? Number.NaN : h.value,
        standing,
        // A guest is asked for neither (ruled 2026-11-07); the boxes are hidden, and nothing typed before the switch goes.
        email: addingGuest ? "" : email,
        phone: addingGuest ? "" : phone,
        ghin,
        handicapBodyId: visitorBody,
        homeClub,
        handicapSource: hSource,
        handicapType: newHandicapType,
        // A reserve waits on the waiting list; a late entry with a flight goes straight into it.
        flightId: !reserve && addFlight && addFlightId ? addFlightId : undefined,
        reserve: reserve || undefined,
      });
      if (!result.ok) {
        setAddError(result.error ?? "Couldn't add that signup.");
        return;
      }
      setFieldSaid(result.said ?? "");
      setAddFlightId("");
      setName("");
      setHandicap("");
      setEmail("");
      setPhone("");
      setGhin("");
      setVisitorBody("");
      setVisitorOpen(false);
      setHomeClub("");
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    // Checked before the upload, not after. Over the platform's body limit the
    // request is rejected before any of our code runs — no error, no result,
    // the screen just does nothing — so the only place this can be caught and
    // explained is here.
    const tooBig = csvSizeRefusal(file.size);
    if (tooBig) {
      setImportResult({ imported: 0, skippedDuplicates: 0, skippedInvalid: 0, error: tooBig });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const text = await file.text();
    /**
     * CHECK THE LIST FIRST (no-email player identity, PR 1). The file is read
     * by the server and shown row by row — member or guest, and why a row is
     * worth a look — before anything is entered. Import is a second press, and
     * the server reads the file again rather than trusting this.
     */
    startTransition(async () => {
      try {
        const res = await previewCsvSignups(text);
        if (!res.ok) {
          setImportResult({ imported: 0, skippedDuplicates: 0, skippedInvalid: 0, error: res.error });
          return;
        }
        setChoices({});
        setPreview({ csv: text, rows: res.rows });
      } catch {
        setImportResult({
          imported: 0,
          skippedDuplicates: 0,
          skippedInvalid: 0,
          error: "That file didn't go through. Check your connection and try again — nothing was added.",
        });
      }
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  /** The preview's rows with the organizer's switches applied — what Import will do. */
  const previewRows = (preview?.rows ?? []).map((r) => (choices[r.row] ? { ...r, standing: choices[r.row], check: null } : r));
  const importing = previewRows.filter((r) => !r.skip);
  const confirmImport = () => {
    if (!preview) return;
    const text = preview.csv;
    startTransition(async () => {
      try {
        setImportResult(await importCsvSignups(text, choices));
        setPreview(null);
        setChoices({});
      } catch {
        // A rejected body, a dropped connection, a timeout. Whatever it was,
        // the organizer needs to know it did not happen rather than be left
        // looking at an unchanged screen.
        setImportResult({
          imported: 0,
          skippedDuplicates: 0,
          skippedInvalid: 0,
          error: "That import didn't go through. Check your connection and try again — nothing was added.",
        });
      }
    });
  };
  /** The template: the header a club fills in (`CSV_TEMPLATE_HEADER`), made in the browser. */
  const downloadTemplate = () => {
    const blob = new Blob([`${toCsv([CSV_TEMPLATE_HEADER.split(",")])}\r\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "entry-list-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * The site's address, read AFTER hydration. It was
   * `typeof window !== "undefined" ? window.location.origin : ""` during
   * render, so the server drew the sign-up box with "/register/…" and the
   * browser hydrated it with "https://…/register/…" — a hydration mismatch on
   * every visit to this screen, found sweeping client components for render-
   * time browser reads (2026-10-06). `useSyncExternalStore` renders the
   * server's answer first and the browser's straight after, which is the one
   * way to read `window` in render that both sides agree on.
   */
  const registrationLink = useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  );
  // The public self-service sign-up link. Empty until registration has been
  // opened at least once (the token is minted then).
  const registerUrl = event.registrationToken ? `${registrationLink}/register/${event.registrationToken}` : "";
  const approveMode = approvalShown === "approve";
  // Sign the invitation with the club's name so the recipient recognises who
  // it's from — a bare link from an unknown app reads like spam.
  const signature = event.organizationName ? `\n— ${event.organizationName}` : "";
  /**
   * The invitation, and the link that actually signs somebody up.
   *
   * This interpolated `registrationLink` — the bare origin — so every
   * invitation ever sent from this screen, by WhatsApp, SMS, the native share
   * sheet or Copy message, carried a URL with no token. It landed the
   * recipient on the home page of an app they have no account for, which is
   * the end of the road for the one feature that exists so they never need
   * one. `registerUrl` is the same string plus `/register/<token>`; the token
   * IS the invitation.
   *
   * No token, no link. An invitation with a dead link is worse than one that
   * says nothing, because the sender believes it worked — hence the guard
   * below, which stops the message going out at all until registration has
   * been opened once and a token exists.
   */
  /**
   * What to offer when there is nothing saved, and what to SEND then too.
   *
   * The buttons below share `fullMessage`, so a blank box would put the club's
   * signature and a bare link in front of a member with no sentence at all.
   * The suggestion stands in for both, which is what makes the placeholder an
   * offer rather than grey text nobody acts on.
   */
  const suggestion = suggestedInvite({ name: event.name, dates: event.dates, course: event.course });
  const body = invite.trim() || suggestion;
  const fullMessage = `${body}${signature}${registerUrl ? `\n\nSign up: ${registerUrl}` : ""}`;

  const sendWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(fullMessage)}`, "_blank", "noopener");
  const sendSms = () => {
    window.location.href = `sms:?&body=${encodeURIComponent(fullMessage)}`;
  };
  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  };
  const shareNative = async () => {
    const nav = navigator as Navigator & { share?: (d: { text: string; title?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: event.name, text: fullMessage });
      } catch {
        /* cancelled */
      }
    } else {
      copy(fullMessage, "share");
    }
  };

  const table = (rows: Signup[], title: string, showFlight: boolean) => {
    const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
    const anySelected = rows.some((r) => selected.has(r.id));
    return (
      <div className="card elev-sm">
        <div className="card-head">
          <span className="card-title" style={{ fontSize: 15 }}>{title} ({rows.length})</span>
          {/* A handicap or an email saves when its box is left — said here, as
              self-saving controls do. Failures already say so (`rowError`). */}
          <SaveState status={tableSaveStatus} />
          {anySelected && (
            <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: "4px 10px" }} disabled={pending || !!doors.bulk} onClick={() => deleteSelected(rows)}>
              <Icon name="trash" /> Delete {rows.filter((r) => selected.has(r.id)).length} selected
            </button>
          )}
          {/* Why it is dead, beside it: after launch players leave one at a time. */}
          {anySelected && doors.bulk && (
            <span className="text-muted" style={{ fontSize: 13, flexBasis: "100%" }}>{doors.bulk}</span>
          )}
        </div>
        <div className="table-scroll">
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 26 }}>
                  <input type="checkbox" aria-label={`Select everyone in ${title}`} checked={allSelected} disabled={rows.length === 0} onChange={() => toggleSelectAll(rows)} />
                </th>
                <th style={{ width: 32 }}>#</th>
                <th>Player</th>
                <th style={{ width: 96, textAlign: "right" }}>Hcp</th>
                {showTees && <th style={{ minWidth: 108 }}>Tees</th>}
                <th>Email</th>
                <th>Phone</th>
                {showFlight && <th>Flight</th>}
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <Fragment key={p.id}>
                <tr>
                  <td><input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} /></td>
                  <td className="text-muted">{i + 1}</td>
                  <td style={{ fontWeight: 500 }}>
                    {p.name}
                    <StandingTags p={p} />
                    <PromotedBadge promotedAt={p.promotedAt} />
                    {/* SHOWN WHERE IT WAS TYPED. "Home club" on the Add form was stored and then
                        drawn nowhere on this screen, so the organizer who typed it could not see
                        it had been kept (the text-box crawl, 2026-10-21). */}
                    {p.homeClub ? (
                      <div className="text-muted" style={{ fontSize: 13, fontWeight: 400 }}>{p.homeClub}</div>
                    ) : null}
                    {/* ON THE ENTRY, NOT THE REPORT (2026-10-24): signed out — the public
                        board, the public report, a share card — this player is "Player
                        (name withheld)"; the field and the staff see the name. Not behind
                        the setup lock: it is asked after the day as often as before. */}
                    {/* Muted by its style, not the `text-muted` class: that class under a
                        name is the home club's line, and a player with no home club has none. */}
                    <label style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 44, fontSize: 13, fontWeight: 400, color: "var(--color-text-muted)" }}>
                      <input
                        type="checkbox"
                        checked={!!p.publicNameWithheld}
                        disabled={pending}
                        onChange={(e) => {
                          const on = e.target.checked;
                          startTransition(async () => {
                            const r = await setNameWithheld(p.id, on);
                            setRowError(r.ok ? "" : `${p.name}: ${r.error ?? "That did not save."}`);
                          });
                        }}
                      />
                      Don&rsquo;t show name on public pages
                    </label>
                  </td>
                  {showTees && (
                    <td>
                      {/* Blank means the round's own set, which is a real
                          answer and the one most of the field will have. The
                          label says what that resolves to rather than showing
                          an empty box that reads as "nothing". */}
                      <select
                        className="input"
                        aria-label={`Tees for ${p.name}`}
                        value={p.teeId ?? ""}
                        disabled={pending || locked}
                        // A FIXED width, not 100%. This table scrolls
                        // sideways, and a percentage let the column collapse
                        // to about thirty pixels: the control rendered as
                        // “Bl…” and “Re”, which is a tee nobody can read and a
                        // choice nobody can make.
                        style={{ width: 100, padding: "3px 4px", fontSize: 13 }}
                        onChange={(e) => commitTee(p.id, e.target.value || null)}
                      >
                        {/* WHAT THIS PLAYER PLAYS IF LEFT ALONE, and whose decision
                            that is: their flight's set, the course's ladies' set, or
                            the tournament's. One label for the whole field said
                            "White (round's)" beside a woman the board had on the
                            reds. */}
                        <option value="">{p.inheritedTee || defaultTeeName || "Tournament's tees"}</option>
                        {tees.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 3, justifyContent: "flex-end", alignItems: "center" }}>
                      <input
                        className="input"
                        // A HANDICAP, AS A GOLFER WRITES ONE (2026-10-13). This was a number box,
                        // opened on the stored figure and read back with parseFloat: a plus
                        // handicap stood here as "-2.4", and typing "+2.4" over it — which a
                        // number box refuses to hold — saved nothing, or with the plus dropped,
                        // 2.4 the wrong way. Text, shown and read like every other handicap.
                        type="text"
                        inputMode="decimal"
                        aria-label={`Handicap for ${p.name}`}
                        // Keyed on what is stored: the box is the browser's own between saves,
                        // so without this it goes on showing a figure the server has replaced.
                        key={`${p.id}:${p.handicap}`}
                        defaultValue={indexFigure(p.handicap)}
                        // Not behind the setup lock: a committee changes a handicap mid-event,
                        // and a round with a card keeps what it was scored off.
                        disabled={pending}
                        style={{ width: 56, padding: "3px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        onKeyDown={leaveOnEnter}
                        onBlur={(e) => {
                          const typed = parseHandicapInput(e.target.value);
                          // Emptied: nothing is saved (it never was), and the box says again what is stored.
                          if (typed.ok && typed.source === "none") {
                            e.target.value = indexFigure(p.handicap);
                            return;
                          }
                          if (!typed.ok) {
                            setRowError(`${p.name}: ${STAFF_HANDICAP_REFUSAL[typed.why]}`, p.id);
                            return;
                          }
                          if (typed.value !== p.handicap) commitIndex(p, typed.value);
                          else setRowError("");
                        }}
                      />
                      <select
                        className="input"
                        value={p.handicapType === "9" ? "9" : "18"}
                        disabled={pending || !!doors.edit}
                        style={{ width: 46, padding: "3px 2px", fontSize: 13 }}
                        onChange={(e) => commitUpdate(p.id, { handicapType: e.target.value })}
                        // The one static tooltip on this screen that was
                        // load-bearing. This select has no visible label at
                        // all — "18h"/"9h" beside a handicap number does not
                        // say itself — so its meaning existed only for
                        // somebody with a mouse to hover. As an accessible
                        // name it is announced instead. Same treatment as the
                        // email column two cells along, and for the same
                        // reason: a sentence per row in a table this dense
                        // would be noise.
                        aria-label={`Handicap index for ${p.name} — 9-hole or 18-hole`}
                      >
                        <option value="18">18h</option>
                        <option value="9">9h</option>
                      </select>
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {/* A GUEST HAS NO EMAIL HERE (2026-11-07): one would make a sign-in
                        account and hand the entry to whoever holds the address. */}
                    {isGuest(p) ? (
                      <span className="text-muted">—</span>
                    ) : (
                    <input
                      className="input"
                      type="email"
                      maxLength={EMAIL_MAX}
                      defaultValue={p.email ?? ""}
                      disabled={pending || !!doors.edit}
                      placeholder="Add email"
                      style={{
                        padding: "3px 6px",
                        fontSize: 13,
                        width: 150,
                      }}
                      // The consequence in the accessible NAME rather than a
                      // `title`, which never appears on a touch device. A
                      // member may play without an email (2026-11-07), so it
                      // is a fact ("No email yet"), not an alarm.
                      aria-label={p.email ? `Email for ${p.name}` : `Email for ${p.name} — ${NO_EMAIL_YET}`}
                      onKeyDown={leaveOnEnter}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (p.email ?? "")) commitUpdate(p.id, { email: v });
                      }}
                    />
                    )}
                  </td>
                  <td className="text-muted" style={{ fontSize: 13 }}>{p.phone || "—"}</td>
                  {showFlight && (
                    <td>
                      {/* A LATE ENTRANT IN NO FLIGHT is offered one here (day-of field
                          changes, PR A) — offered, not forced. Only an unplaced
                          player: moving a placed one is the Flights board's act. */}
                      {!p.flight && flights.length > 0 && !doors["place-in-flight"] ? (
                        <select
                          className="input"
                          aria-label={`Flight for ${p.name}`}
                          value=""
                          disabled={pending}
                          style={{ width: 130, padding: "3px 4px", fontSize: 13 }}
                          onChange={(e) => e.target.value && place(p, e.target.value)}
                        >
                          <option value="">Choose a flight</option>
                          {flights.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        p.flight || "—"
                      )}
                    </td>
                  )}
                  <td style={{ textAlign: "right" }}>
                    {/* An unlabelled × at the end of a row of EDITABLE fields:
                        a thumb aiming at the phone cell lands on it. The bulk
                        Remove above already asks in a dialog, because it has a
                        sentence to say about withdrawals; this per-row one had
                        nothing at all.

                        UNDER WAY IT IS "WITHDRAW" (day-of field changes, PR A):
                        open to an Assistant too, never a delete, and undone by
                        Put back under Withdrawn. The note says so before the tap. */}
                    <ConfirmButton
                      icon="x"
                      title={underWay ? `Withdraw ${p.name}` : `Remove ${p.name} from the field`}
                      confirmLabel={underWay ? "Withdraw" : "Remove"}
                      note={
                        underWay
                          ? withdrawConfirmation(p.name)
                          : undefined
                      }
                      disabled={pending || !!doors.withdraw}
                      onConfirm={() => withdraw(p)}
                    />
                  </td>
                </tr>
                {rowSaid.at === p.id && rowSaid.text && (
                  <tr>
                    <td colSpan={20} style={{ paddingTop: 0 }}>
                      <p className="form-error" role="alert" style={{ margin: 0 }} ref={bringIntoView}>
                        <Icon name="warning-circle" /> {rowSaid.text}
                      </p>
                    </td>
                  </tr>
                )}
                {memberOffer?.playerId === p.id && (
                  <tr>
                    <td colSpan={20} style={{ paddingTop: 0 }}>
                      {memberOffer.done ? (
                        <p role="status" className="text-muted" style={{ fontSize: 13, margin: 0 }}>{memberOffer.done}</p>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
                          <span>
                            Members still has <b>{indexFigure(memberOffer.memberFrom)}</b> for {memberOffer.name}, which every
                            tournament they enter copies.
                          </span>
                          <button type="button" className="btn btn-secondary" style={{ minHeight: 44, fontSize: 13 }} disabled={pending} onClick={() => pushToMembers(memberOffer)}>
                            Make it {indexFigure(memberOffer.to)} on Members
                          </button>
                          <button type="button" className="btn btn-secondary" style={{ minHeight: 44, fontSize: 13 }} onClick={() => setMemberOffer(null)}>
                            Leave it
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={showFlight ? 8 : 7} className="text-muted" style={{ padding: "10px 6px" }}>None yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* The title alone, as on Rounds & formats (2026-10-16): "Set up" is the strip
          and the sidebar; the subtitle described the lists below. One line only for
          a society taking entries before it has chosen a format (Ajay: "hard to set
          up a round or format unless they know how many signed up"). */}
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Entries</h1>
        {noFormatYet && (
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
            No format yet — players see &ldquo;Format to be confirmed&rdquo;. Choose it on{" "}
            <a href="/stages" style={{ color: "var(--color-accent-200)" }}>Rounds &amp; formats</a> when you know the numbers.
          </p>
        )}
      </div>

      {/* UNDER WAY, THIS SCREEN SAYS WHAT IS STILL OPEN (day-of field changes,
          PR A) in place of "Setup locked" — the banner's words come from the one
          field rule, so it never promises an add the server refuses. */}
      <ScopeLockBanner locks={fieldLocks} correction={correction} isAdmin={isAdmin} open={underWay} />
      {fieldSaid && (
        <p role="status" className="card elev-sm" style={{ margin: "0 0 16px", fontSize: 14 }}>
          <Icon name="info" /> {fieldSaid}
        </p>
      )}
      {/* THE UNPLACED FLAG (J04, PR 7a): who is in the field but in no flight,
          by name, for as long as it is true — "Choose a flight" beside each
          name below is the way to put them in one. */}
      {unplacedFlag && (
        <p className="card elev-sm" style={{ margin: "0 0 16px", fontSize: 14 }} data-testid="unplaced-flag">
          <Icon name="warning" /> {unplacedFlag}
        </p>
      )}

      {gaps.lines.length > 0 && (
        <div
          className="card elev-sm"
          style={{
            marginBottom: 16,
            flexDirection: "row",
            alignItems: gaps.lines.length > 1 ? "flex-start" : "center",
            gap: 10,
            borderColor: "var(--color-accent)",
          }}
        >
          <Icon
            name="warning-circle"
            style={{ color: "var(--color-accent-200)", fontSize: 18, marginTop: gaps.lines.length > 1 ? 1 : 0 }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {/* Each line's first sentence, the rest an ⓘ away (2026-10-05) —
                the count is what an organizer acts on; why the entries are
                not a mistake is there when asked. */}
            {gaps.lines.map((line) => {
              const cut = line.indexOf(". ");
              return cut < 0 ? (
                <span key={line} style={{ fontSize: 14 }}>
                  {line}
                </span>
              ) : (
                <MoreInfo key={line} short={line.slice(0, cut + 1)}>
                  {line}
                </MoreInfo>
              );
            })}
          </div>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Confirmed</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{confirmed.length}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>
            {unlimited ? "unlimited field" : `of ${event.capacity} capacity`}
            {/* Said out loud, because nothing else on the screen can say it:
                `spotsLeft` is clamped at zero, so "spots remaining: 0" reads
                the same whether the field is exactly full or three over — and
                the organizer drawing a tee sheet for thirty-two has
                thirty-three people arriving. See `overCapacity`. */}
            {over > 0 && (
              <>
                {" · "}
                <span style={{ color: "var(--color-danger)" }}>{over} over</span>
              </>
            )}
          </div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Waitlisted</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{waitlist.length}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>bumped in if a spot opens</div>
        </div>
      </div>

      {/* ARE ENTRIES OPEN, UNTIL WHEN, HOW MANY, WITH APPROVAL OR NOT — one card,
          one state line, one button (the entries cleanup, 2026-11-05). */}
      <EntryTermsCard
        key={`${event.regOpens}|${event.regDeadline}|${event.storedCapacity ?? event.capacity}`}
        entries={entries}
        regOpens={event.regOpens}
        regDeadline={event.regDeadline}
        capacity={event.storedCapacity ?? event.capacity}
        planLimit={event.planLimit ?? null}
        approveMode={approveMode}
        showApproval={showApproval}
        locked={locked}
        canAdd={!doors.add}
        isAdmin={isAdmin}
        locale={event.locale}
      />

      {/* THE TWO SELF-SERVICE PANELS, BEHIND ONE DISCLOSURE.
          ─────────────────────────────────────────────────
          There are two ways somebody gets into a field: you enter them, or
          they enter themselves. This screen had both, and put the second
          first — the sign-up link and the invite panel came to about 700px
          of screen ahead of the roster picker and the add form, so a club
          secretary whose next act was "tick forty members" scrolled past two
          panels about a link they were never going to send.

          Neither is the wrong feature. A society taking public entries wants
          exactly this, which is why the disclosure OPENS ITSELF when the link
          is actually published: somebody using it never has to find it, and
          somebody who is not never has to scroll past it. Derived from a real
          signal rather than a guess about who is looking.

          Kept in place rather than moved below the field controls. Moving it
          would put the sign-up link after the table of people who signed up
          through it, and this section is still the first answer to "how do
          people get in". */}
      <button
        type="button"
        onClick={() => setSelfServeOpen((v) => !v)}
        aria-expanded={selfServeOpen}
        className="card elev-sm"
        style={{
          width: "100%",
          marginBottom: selfServeOpen ? 12 : 16,
          textAlign: "left",
          display: "flex",
          // `.card` is a column; without this the label, the summary and the
          // caret stack into three centred rows instead of reading as a row.
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 44,
          cursor: "pointer",
          color: "var(--color-text)",
          border: "1px solid var(--color-divider)",
        }}
      >
        <Icon
          name="link"
          style={{ fontSize: 16, flex: "none", color: event.registrationOpen ? "var(--color-accent-2-200)" : "var(--color-neutral-500)" }}
        />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Let players sign themselves up</span>
          {/* The state, in the summary, so it never has to be opened to be
              read. "Not published" is the answer most organizers need and the
              one that used to cost a scroll through both panels to find. */}
          <span className="text-muted" style={{ display: "block", fontSize: 13, marginTop: 2, lineHeight: 1.45 }}>
            {/* Short — it sits in the panel's own heading (2026-10-05). */}
            {event.registrationOpen ? "The public sign-up link is live." : "No public link yet — open entries above."}
          </span>
        </span>
        <Icon
          name={selfServeOpen ? "caret-up" : "caret-down"}
          style={{ fontSize: 13, color: "var(--color-neutral-500)", marginLeft: "auto", flex: "none" }}
        />
      </button>

      {selfServeOpen && (
      <>
      {/* Self-service registration: share a link and people register themselves.
          Separate from "Invite players" BELOW — that hands someone this
          console's sign-up; this hands anyone a public, no-account entry form.

          Named for the LINK, not for "registration". It used to be titled
          "Open registration", with a button reading "Open registration" /
          "Close sign-ups" — sitting a few inches under a banner whose button
          reads "Close registration". Two switches, one word, and they are not
          opposites: the banner is `registrationOverride`, whether this
          tournament takes entries at all; this one is `registrationOpen`,
          whether the public link exists. An organizer wanting to stop people
          signing up had two plausible controls and no way to tell them apart. */}
      <div className="card elev-sm" style={{ marginBottom: 16, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <span className="card-title" style={{ fontSize: 15 }}>Public sign-up link</span>
            <p className="text-muted" style={{ fontSize: 13, margin: "2px 0 0" }}>
              Share a link and people sign themselves up — no account needed. Entries appear in the field below.
            </p>
          </div>
        </div>

        {/* Both switches on, and off. A published link on a tournament that is
            not accepting entries is live, copyable, and turns away everybody
            who follows it — `decideIntake` checks `registrationOpen` AND
            `registrationStatus`. The organizer could see a working link and a
            "Closed" chip four inches apart and had nothing joining the two. */}
        {entries.linkPublished && !entries.open && (
          <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
            {/* The reason in a few words. The full sentence lives on the
                banner above; a third copy of it down here was the one that
                made the screen read as though the app were nagging. */}
            <Icon name="warning-circle" /> The link is live but this tournament is not taking
            entries — anyone who follows it is turned away{reg.short ? ` (${reg.short})` : ""}.
          </p>
        )}

        {event.registrationOpen && (
          <>
            {registerUrl && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="input"
                  readOnly
                  value={registerUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ flex: 1, minWidth: 220, fontSize: 13, fontFamily: "var(--font-mono, monospace)" }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => copy(registerUrl, "reg")}>
                  <Icon name="copy" /> {copied === "reg" ? "Copied" : "Copy link"}
                </button>
                {/* P3: a secret with no way to change it is a secret you keep
                    until it stops being one. Confirmed, because every copy of
                    the old URL dies the moment this runs — which is the point,
                    and not something to do by mis-tapping. Admin only. */}
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pending}
                    title="Replace this link — the old one stops working"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Replace the sign-up link?\n\nThe current link stops working immediately — anyone who already has it, including in an email you sent, will get 'this registration link isn't open'. You'll need to send the new one out.",
                        )
                      ) {
                        return;
                      }
                      startTransition(async () => {
                        const res = await rotatePublicToken("registration");
                        setRowError(res.ok ? "" : res.error ?? "Couldn't replace that link.");
                      });
                    }}
                  >
                    <Icon name="arrows-clockwise" /> New link
                  </button>
                )}
              </div>
            )}
            {registerUrl && (
              <SignUpPoster
                url={registerUrl}
                name={event.name}
                when={event.dates.trim()}
                where={[event.course.trim(), event.city.trim()].filter(Boolean).join(", ")}
              />
            )}

            {/* Per tournament, on every plan (decisions review A7, 2026-10-21).
                The free plan used to force this on and lock the switch. A phone
                number is not needed to run a competition: every extra required
                field costs entries, and the members it turns away are the ones
                least likely to have a mobile at all, so it is the club's call. */}
            <div className="field" style={{ marginTop: 2 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={requirePhoneShown}
                  disabled={pending || locked}
                  onChange={(e) => {
                    const on = e.target.checked;
                    startTransition(async () => {
                      setSwitchRefused("");
                      showRequirePhone(on);
                      try {
                        const res = caughtUp(await setRequirePhone(on));
                        if (!res.ok) setSwitchRefused(res.error ?? "That change was not saved.");
                      } catch {
                        setSwitchRefused("That change was not saved. Check the connection.");
                      }
                    });
                  }}
                  style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
                />
                <span>
                  <span style={{ fontWeight: 500 }}>Require a mobile number</span>
                  <span className="text-muted" style={{ display: "block", fontSize: 13, lineHeight: 1.6 }}>
                    {event.requirePhone
                      ? "The sign-up form asks for a mobile and won't accept an entry without one. Use this for a shotgun start, where you may need to ring a group that hasn't arrived."
                      : "The sign-up form asks for a mobile but accepts an entry without one. Most tournaments don't need it — every extra required field costs you entries."}
                  </span>
                </span>
              </label>
              {switchRefused && (
                <p role="alert" style={{ fontSize: 13, margin: "6px 0 0", color: "var(--color-danger)" }}>
                  {switchRefused}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="card elev-sm" style={{ marginBottom: 16, gap: 12 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Invite players</span>
        <p className="text-muted" style={{ fontSize: 13, margin: "-4px 0 0" }}>
          Share the sign-up message and link. (Direct sending to a WhatsApp group needs the WhatsApp Business API —
          for now this opens a share sheet you confirm.)
        </p>
        <div className="field">
          {/* Tied to its box, so a screen reader names it: this caption had no
              `htmlFor` and the box was announced as an unnamed text area. */}
          <label htmlFor={`${fid}-invite`}>Message</label>
          {/* A PLACEHOLDER, never a stored value — see `suggestedInvite`. It is
              rebuilt from the tournament on every render, so it cannot be wrong
              about the date the way a saved sentence can; that is exactly what
              went wrong with the one a copy used to inherit. */}
          <textarea
            id={`${fid}-invite`}
            className="input"
            rows={3}
            value={invite}
            placeholder={suggestion}
            onChange={(e) => setInvite(e.target.value)}
            onBlur={() => {
              // Leaving it unchanged saves nothing, and says nothing.
              if (invite === savedInvite.current) return;
              savedInvite.current = invite;
              startInviteSave(() => setInviteMessage(invite));
            }}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
          <SaveState status={inviteSaveStatus} />
        </div>
        {/* Nothing to send until a token exists. Every one of these buttons
            puts the link in front of a member, and a link with no token is a
            dead end they cannot get past — better to say why than to hand the
            organizer a broken invitation that looks like it worked. */}
        {!registerUrl && (
          <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
            {/* Names the control by the words now on it. A refusal that tells
                somebody to press a button that no longer exists is worse than
                no refusal at all. */}
            <Icon name="warning-circle" /> Open entries first — the sign-up link doesn&rsquo;t exist
            until you do, so there is nothing to invite anyone to yet.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={sendWhatsApp} disabled={!registerUrl}><Icon name="whatsapp-logo" weight="fill" /> WhatsApp</button>
          <button type="button" className="btn btn-secondary" onClick={sendSms} disabled={!registerUrl}><Icon name="chat-text" /> SMS / Text</button>
          <button type="button" className="btn btn-secondary" onClick={shareNative} disabled={!registerUrl}><Icon name="share-network" /> {copied === "share" ? "Copied" : "Share…"}</button>
          <button type="button" className="btn btn-secondary" onClick={() => copy(fullMessage, "msg")} disabled={!registerUrl}><Icon name="copy" /> {copied === "msg" ? "Copied" : "Copy message"}</button>
          {/* Also the sign-up link, not the origin — same bug, second door. */}
          <button type="button" className="btn btn-secondary" onClick={() => copy(registerUrl, "link")} disabled={!registerUrl}><Icon name="link" /> {copied === "link" ? "Copied" : "Copy link"}</button>
        </div>
      </div>
      </>
      )}

      <div className="page-split" style={{ display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <RosterPicker candidates={roster} eventName={event.name} locked={!!doors.add} />
        <div className="card elev-sm" style={{ gap: 10 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Add someone new</span>
          <p className="text-muted" style={{ fontSize: 13, margin: "-4px 0 0" }}>
            Anyone added here joins the {org.noun} roster too, so you only enter their details once.
          </p>
          <div className="field"><label htmlFor={`${fid}-name`}>Player name</label><input id={`${fid}-name`} className="input" value={name} maxLength={PERSON_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></div>
          {/* MEMBER OR GUEST (Ajay, 2026-11-07), above Email, with the hint. */}
          <div className="field">
            <label id={`${fid}-standing`}>Member or guest</label>
            <div className="seg" style={{ width: "100%" }} role="radiogroup" aria-labelledby={`${fid}-standing`}>
              {ENTRY_STANDINGS.map((s) => (
                <label className="seg-opt" key={s} style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="standing" value={s} checked={standing === s} onChange={() => setStanding(s)} />
                  {STANDING_CHOICE[s]}
                </label>
              ))}
            </div>
            <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }} data-testid="standing-hint">
              {hint}
            </p>
            {/* Before the press: a guest has no email, so on a tournament without round
                codes this add turns them on, as the member's empty-Email line says. */}
            {addingGuest && guestCodesNote(needsEmail) && (
              <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }} data-testid="guest-codes-note">
                {guestCodesNote(needsEmail)}
              </p>
            )}
          </div>
          {!addingGuest && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="field">
              {/* Optional for a member, whatever the tournament (2026-11-07): an entry without
                  one turns Round Codes on, and the screen says so before the press and after it. */}
              <label htmlFor={`${fid}-email`}>Email <span style={{ color: "var(--color-accent-200)" }}>· optional, lets them sign in</span></label>
              <input id={`${fid}-email`} className="input" type="email" maxLength={EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email" />
              {!email.trim() && (
                <span className="text-muted" style={{ fontSize: 13 }}>
                  {/* Before the press: on a tournament without round codes, this add turns them on. */}
                  {memberWithoutEmail(needsEmail)}
                </span>
              )}
            </div>
            {/* SAID LIKE EMAIL IS, WHEN IT IS REQUIRED (2026-09-26). Where the
                tournament asks for a mobile the server refuses an add without
                one — but this label said only "Phone", so a new
                organizer typed a name, pressed Add, and was refused. Email
                beside it already says when it is required; now Phone does too,
                and Add waits for it the same way. */}
            <div className="field">
              <label htmlFor={`${fid}-phone`}>Mobile {phoneRequired && <span style={{ color: "var(--color-accent-200)" }}>· required</span>}</label>
              <input id={`${fid}-phone`} className="input" type="tel" maxLength={PHONE_MAX} required={phoneRequired} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" style={phoneRequired && !phone.trim() ? { borderColor: "var(--color-accent)" } : undefined} />
            </div>
          </div>
          )}
          {/* A visitor from another country plays off their own body's index —
              valid everywhere under WHS. Folded away (Ajay: "I dont want to
              complicate"): almost every entrant is local, and the form reads
              exactly as before until somebody needs it. */}
          {visitorOpen ? (
            <div className="field">
              <label htmlFor={`${fid}-body`}>Visitor&rsquo;s handicap body</label>
              <select id={`${fid}-body`} className="input" value={visitorBody} onChange={(e) => setVisitorBody(e.target.value)}>
                <option value="">{`${handicapBody.label === "Association" ? "This club's national association" : handicapBody.label} (this club's)`}</option>
                {HANDICAP_BODIES.filter((b) => b.id !== handicapBody.id).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setVisitorOpen(true)}
              style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, minHeight: "var(--tap-min, 32px)", cursor: "pointer", fontSize: 13, color: "var(--color-accent-200)" }}
            >
              Visitor from another country?
            </button>
          )}
          <div className="field">
            <label>Handicap source</label>
            <div className="seg" style={{ width: "100%" }}>
              {[["ghin", bodyWords.label], ["manual", "Manual"], ["none", "None"]].map(([v, l]) => (
                <label className="seg-opt" key={v} style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="hsrc" checked={hSource === v} onChange={() => setHSource(v)} />{l}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="field"><label htmlFor={`${fid}-hcp`}>{hSource === "ghin" ? "Handicap index" : "Handicap"}</label><input id={`${fid}-hcp`} className="input" type="text" inputMode="decimal" value={handicap} onChange={(e) => setHandicap(e.target.value)} placeholder="12.4" disabled={hSource === "none"} /></div>
            <div className="field"><label htmlFor={`${fid}-ghin`}>{bodyWords.number.charAt(0).toUpperCase() + bodyWords.number.slice(1)}</label><input id={`${fid}-ghin`} className="input" value={ghin} onChange={(e) => setGhin(e.target.value)} placeholder="0000000" disabled={hSource !== "ghin"} /></div>
          </div>
          <div className="field">
            <label>Handicap is a…</label>
            <div className="seg" style={{ width: "100%" }}>
              {[["18", "18-hole index"], ["9", "9-hole index"]].map(([v, l]) => (
                <label className="seg-opt" key={v} style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="hctype" checked={newHandicapType === v} onChange={() => setNewHandicapType(v)} disabled={hSource === "none"} />{l}
                </label>
              ))}
            </div>
          </div>
          <div className="field"><label htmlFor={`${fid}-club`}>Home club</label><input id={`${fid}-club`} className="input" value={homeClub} maxLength={PLACE_MAX} onChange={(e) => setHomeClub(e.target.value)} placeholder="Optional" /></div>
          {/* Gated on the field's add door like the roster picker above —
              `addSignup` asks the same rule — and this was once the one button
              on the screen that still offered a refused add. */}
          {/* THE FLIGHT, WITH THE ENTRY (panel Q3, PR 7a): offered where one
              division is a complete setup, required in a launched round robin,
              where a player in no flight has no matches. */}
          {addFlight && flights.length > 0 && (
            <div className="field">
              <label htmlFor={`${fid}-flight`}>
                Flight{" "}
                <span style={{ color: "var(--color-accent-200)" }}>{addFlight === "required" ? "· required in a round robin" : "· optional"}</span>
              </label>
              <select id={`${fid}-flight`} className="input" value={addFlightId} onChange={(e) => setAddFlightId(e.target.value)}>
                <option value="">{addFlight === "required" ? "Choose a flight" : "No flight yet"}</option>
                {flights.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
          )}
          <button type="button" className="btn btn-primary btn-block" disabled={pending || !!addRefusal || !name.trim() || (!addingGuest && phoneRequired && !phone.trim())} onClick={() => submitAdd()}><Icon name="plus" /> {underWay ? "Add late entry" : "Add to field"}</button>
          {/* Said HERE, where the dead button is — the banner is a screen and a
              half above a form somebody has just filled in. The rule's own words. */}
          {addRefusal && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              {/* The rule's words already say who can unlock (an Organizer), true for either reader. */}
              {addRefusal}
            </p>
          )}
          {/* A KNOCKOUT WHOSE DRAW IS MADE takes a reserve instead (panel Q3):
              the way out its refusal names, one press away. */}
          {offerReserve && !doors.reserve && (
            <button type="button" className="btn btn-secondary btn-block" disabled={pending || !name.trim()} onClick={() => submitAdd(true)}>
              <Icon name="plus" /> Add as a reserve
            </button>
          )}
          {addError && (
            <p className="form-error" role="alert" ref={bringIntoView}>
              <Icon name="warning-circle" /> {addError}
            </p>
          )}
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            {hSource === "ghin"
              ? `Indexes aren't read from ${bodyWords.prose} automatically yet — type this player's index as ${bodyWords.prose} shows it.`
              : "Auto-confirms while under capacity; overflow goes to the waitlist."}
          </p>
          <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
            {/* Gated on the field's bulk door: `importCsvSignups` asks the same
                rule, and a list is not a day-of act, so it stays shut after launch. */}
            <label
              className="btn btn-secondary btn-block"
              aria-disabled={!!doors.bulk || undefined}
              style={{ cursor: doors.bulk ? "not-allowed" : "pointer", justifyContent: "center", opacity: doors.bulk ? 0.5 : undefined }}
            >
              <Icon name="upload-simple" /> Import CSV
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} disabled={pending || !!doors.bulk} style={{ display: "none" }} />
            </label>
            {doors.bulk && (
              <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                {doors.bulk}
              </p>
            )}
            {/* The hint beside the button: a list is where members and guests are told apart (2026-11-07). */}
            <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }} data-testid="standing-hint">
              {hint}
            </p>
            <button
              type="button"
              onClick={downloadTemplate}
              style={{ background: "none", border: "none", padding: 0, minHeight: "var(--tap-min, 32px)", cursor: "pointer", fontSize: 13, color: "var(--color-accent-200)" }}
            >
              <Icon name="download-simple" /> Download template
            </button>
            {/* Says what this tournament actually requires, rather than what
                every tournament used to. No email is required any more
                (2026-11-07): a member may enter without one, a guest needs none. */}
            {/* One line, the full rules an ⓘ away (2026-10-05). */}
            <MoreInfo
              short={`A header row, then: ${["name", ...(phoneRequired ? ["phone"] : [])].join(", ")}.`}
              style={{ marginTop: 6 }}
            >
              First row must be a header. Required columns: {["name", ...(phoneRequired ? ["phone"] : [])].join(", ")}
              {phoneRequired ? ", and this tournament collects a mobile for every member" : ""}. Also read: email,{" "}
              {phoneRequired ? "" : "phone, "}handicap, handicap type (9/18). {CSV_STANDING_GUIDE} You check the list before
              anything is added. Rows with no name or a broken email are skipped, and so is a row whose email (or, with
              no email, whose name) is already in the field.
            </MoreInfo>
            {importResult && (
              importResult.error ? (
                <p style={{ fontSize: 13, margin: "8px 0 0", color: "var(--color-danger)" }}>
                  <Icon name="warning-circle" /> {importResult.error}
                </p>
              ) : (
                <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }} role="status">
                  <Icon name="check-circle" style={{ color: "var(--color-accent-2-200)" }} /> Imported {importResult.imported}
                  {importResult.members !== undefined && importResult.guests !== undefined
                    ? ` (${importResult.members} ${importResult.members === 1 ? "member" : "members"}, ${importResult.guests} ${importResult.guests === 1 ? "guest" : "guests"})`
                    : ""}
                  {importResult.skippedDuplicates > 0 ? `, skipped ${importResult.skippedDuplicates} duplicate${importResult.skippedDuplicates === 1 ? "" : "s"}` : ""}
                  {importResult.skippedInvalid > 0 ? `, skipped ${importResult.skippedInvalid} invalid row${importResult.skippedInvalid === 1 ? "" : "s"}` : ""}.
                  {importResult.codesTurnedOn ? ` ${CODES_TURNED_ON}` : ""}
                </p>
              )
            )}
          </div>
        </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rowError && !rowSaid.at && (
            <p className="form-error" role="alert">
              <Icon name="warning-circle" /> {rowError}
            </p>
          )}
          {/* CHECK THE LIST (no-email player identity, PR 1): every row of the file,
              member or guest, why a default is worth a look, and a switch on each.
              Nothing is entered until Import is pressed. */}
          {preview && (
            <div className="card elev-sm" style={{ borderColor: "var(--color-accent)", gap: 8 }} data-testid="csv-preview" ref={bringIntoView}>
              <span className="card-title" style={{ fontSize: 15 }}>Check the list</span>
              <p style={{ fontSize: 13, margin: 0 }} role="status">
                {previewSummary({
                  members: importing.filter((r) => r.standing === "member").length,
                  toCheck: importing.filter((r) => r.standing === "member" && r.check).length,
                  guests: importing.filter((r) => r.standing === "guest").length,
                  skipped: previewRows.length - importing.length,
                })}
              </p>
              <div className="table-scroll">
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th style={{ textAlign: "right" }}>Hcp</th>
                      <th>Email</th>
                      <th>Handicap ID</th>
                      <th>Member or guest</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r) => (
                      <tr key={r.row} data-row={r.row} style={r.skip ? { opacity: 0.6 } : undefined}>
                        <td style={{ fontWeight: 500 }}>{r.name || "—"}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.handicapLabel}</td>
                        <td className="text-muted">
                          {r.standing === "guest" ? (r.email ? GUEST_EMAIL_DROPPED : "—") : r.email || NO_EMAIL_YET}
                        </td>
                        <td className="text-muted">{r.handicapId || "—"}</td>
                        <td>
                          {r.skip ? (
                            <span className="text-muted">
                              {r.skip === "duplicate" ? "Already in the field: skipped" : "Skipped: no name, a broken email or no mobile"}
                            </span>
                          ) : (
                            <>
                              <span data-standing={r.standing}>{STANDING_CHOICE[r.standing]}</span>
                              {r.check && (
                                <span style={{ display: "block", color: "var(--color-accent-200)" }}>
                                  <Icon name="warning-circle" /> Check: {CHECK_WORDS[r.check]}
                                  {r.rosterName ? ` (${r.rosterName})` : ""}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {!r.skip && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ fontSize: 13, padding: "4px 10px", minHeight: 44 }}
                              disabled={pending}
                              aria-label={`${r.standing === "member" ? "Make guest" : "Make member"}: ${r.name}`}
                              onClick={() =>
                                setChoices((prev) => ({ ...prev, [r.row]: r.standing === "member" ? "guest" : "member" }))
                              }
                            >
                              {r.standing === "member" ? "Make guest" : "Make member"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary" disabled={pending || importing.length === 0 || !!doors.bulk} onClick={confirmImport}>
                  <Icon name="check" /> {importButtonWords(importing.length)}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pending}
                  onClick={() => {
                    setPreview(null);
                    setChoices({});
                    fileRef.current?.click();
                  }}
                >
                  Choose another file
                </button>
              </div>
            </div>
          )}
          {pendingEntries.length > 0 && (
            <div className="card elev-sm" style={{ borderColor: "var(--color-accent)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="hourglass-medium" style={{ color: "var(--color-accent-200)" }} />
                <span className="card-title" style={{ fontSize: 15 }}>Pending approval ({pendingEntries.length})</span>
              </div>
              <p className="text-muted" style={{ fontSize: 13, margin: "-2px 0 2px" }}>
                Self-service entries waiting for you. Accepting one puts it in the field (or the waitlist if full).
              </p>
              <p className="text-muted" style={{ fontSize: 13, margin: 0 }} data-testid="standing-hint">
                {hint}
              </p>
              {/* Why Accept is dead, on the page (never a tooltip): the field rule's own words. */}
              {doors.approve && (
                <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                  <Icon name="lock-simple" /> {doors.approve}
                </p>
              )}
              <div className="table-scroll">
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th style={{ width: 70, textAlign: "right" }}>Hcp</th>
                      <th>Email</th>
                      <th style={{ width: 150 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {pendingEntries.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 500 }}>
                          {p.name}
                          <StandingTags p={p} />
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {/* One reader for the two fields. A pending entry
                              from a club playing off association indexes has
                              no figure yet, and printing the stored 0 puts a
                              scratch golfer in the queue. */}
                          {indexLabel(p)}
                        </td>
                        <td className="text-muted" style={{ fontSize: 13 }}>{p.email || "—"}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: 13, padding: "4px 10px", marginRight: 6 }}
                            disabled={pending || !!doors.approve}
                            onClick={() =>
                              startTransition(async () => {
                                const res = await approveSignup(p.id);
                                setRowError(res.ok ? "" : `${p.name}: ${res.error ?? "That did not save."}`);
                              })
                            }
                          >
                            <Icon name="check" /> Accept
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 13, padding: "4px 10px" }}
                            disabled={pending || !!doors.withdraw}
                            onClick={() => withdraw(p)}
                          >
                            Decline
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {table(confirmed, "Confirmed field", true)}
          {table(waitlist, "Waitlist", false)}
        </div>
      </div>
    </>
  );
}

/**
 * MEMBER OR GUEST, beside the name (no-email player identity, PR 1): "Member"
 * or "Guest", and "No email yet" for a member without one. Read through
 * `entryStanding`, so an entry made before A039 reads as a member.
 */
function StandingTags({ p }: { p: { standing?: string; email?: string } }) {
  const s = entryStanding(p);
  // Muted by its style, not the `text-muted` class: that class under a name is the home club's line.
  const tag = {
    marginLeft: 8,
    fontSize: 13,
    fontWeight: 400,
    padding: "1px 7px",
    borderRadius: 999,
    whiteSpace: "nowrap" as const,
    border: "1px solid var(--color-divider)",
    color: "var(--color-text-muted)",
  };
  return (
    <>
      <span style={tag} data-standing={s}>
        {STANDING_TAG[s]}
      </span>
      {s === "member" && !(p.email ?? "").trim() && <span style={tag}>{NO_EMAIL_YET}</span>}
    </>
  );
}

/**
 * "Promoted 2 days ago", beside a player who came off the waitlist.
 *
 * The organizer's half of the promise the registration email makes. The player
 * is asked to say if they can no longer play (within 48 hours, or sooner
 * when the round is near); this is how
 * somebody notices that they have not, and picks up the phone.
 *
 * It is a prompt to chase, never a status. The player is in the field either
 * way — nothing here is provisional, nothing expires, and no other screen has
 * to know this badge exists.
 *
 * Rendered on the client on purpose: "2 days ago" against the reader's own
 * clock is the point, and computing it on the server would freeze it at
 * whatever the page was last rendered.
 */
function PromotedBadge({ promotedAt }: { promotedAt?: string | null }) {
  /**
   * "Rendered on the client on purpose" above is half right, and the half it
   * misses is what made this a bug: a `"use client"` component is still
   * SERVER-rendered for the initial HTML. Both sides ran `Date.now()`, so a
   * badge sitting either side of the 48-hour line went out as one label and
   * hydrated as the other — React #418, the same fault as `MessagesClient`'s
   * relative timestamps and the one `LiveRefresh` documents.
   *
   * Mount-only, so the server and the first client render agree. Until then
   * there is no clock and the badge is not drawn; a waitlist badge is not
   * worth a mismatch, and it appears on the same tick as everything else.
   */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  if (now === null) return null;
  const state = promotionState(promotedAt, now);
  if (state.kind === "none") return null;
  const overdue = state.kind === "overdue";
  return (
    <span
      // `text-muted` and the two tokens below are the ones this app actually
      // defines. `--color-warning` was invented when this was written and
      // resolved to nothing, which is why it was avoided; it is a real token
      // since #464. `danger` is still right here — an unanswered promotion is
      // a problem to chase, not a caution.
      className={overdue ? undefined : "text-muted"}
      title={
        overdue
          ? "Promoted off the waitlist and not heard from since — worth a call to confirm they are playing."
          : "Promoted off the waitlist. They were asked to tell you if they cannot play."
      }
      style={{
        marginLeft: 8,
        fontSize: 13,
        fontWeight: 500,
        padding: "1px 7px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        color: overdue ? "var(--color-danger)" : undefined,
        border: `1px solid ${overdue ? "var(--color-danger)" : "var(--color-divider)"}`,
      }}
    >
      {state.label}
    </span>
  );
}
