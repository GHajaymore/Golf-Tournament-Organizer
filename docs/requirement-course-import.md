# Importing course cards from OpenGolfAPI — REQUIREMENT, not built

Researched 2026-08-21 at Ajay's request: is there a free source for course cards
or handicaps? Answer: **yes for cards, no for handicaps, and the second is not
a gap that will close.**

**Nothing here is implemented.**

## What the source actually gives

`https://api.opengolfapi.org` — **free, no API key**, ODbL 1.0.

Verified by calling it rather than reading the docs, which matters: the
published OpenAPI spec leaves `tees` and `holes` as untyped arrays, so the field
names are only discoverable from a live response. Pebble Beach returned:

    GET /v1/courses/search?q=pebble%20beach     → id, name, city, state, par, lat/lng
    GET /api/v1/courses/{id}                    → tees[], holes_data[], ratings, …

    holes_data[0]  { "number": 1, "par": 4, "handicap_index": 6,
                     "yardages": { "blue": 378, "white": 337, "red": 310, … } }
    tees[0]        { "tee_name": "Blue", "gender": "Male",
                     "course_rating": 74.9, "slope": 144, "par": 72, "yardage": 6802 }

Nine tee sets, split by gender — which the WHS course-handicap calculation
needs and which most free sources omit.

## It maps onto what we already store

| Ours | Theirs |
| --- | --- |
| `Course.pars` | `holes_data[].par` |
| `Course.strokeIndex` | `holes_data[].handicap_index` |
| `Course.yards` | `holes_data[].yardages[tee_colour]` |
| `Course.name` / `city` | `course_name` / `city` |
| `Tee.name` | `tees[].tee_name` |
| `Tee.gender` | `tees[].gender` |
| `Tee.courseRating` | `tees[].course_rating` |
| `Tee.slopeRating` | `tees[].slope` |
| `Tee.par` | `tees[].par` |

No field we need is missing, which is unusual — **stroke index is the one most
free sources drop**, and it is the one this app cannot work without.

## The trust model already exists — use it, do not invent a second

`Course.source` is already `"manual" | "imported"` with a `verifiedAt`
timestamp, and its own comment already states the rule:

> *imported — pulled from the web or a club site. NOT trusted until checked. An
> imported card is usable, but the app says so until a human confirms it.*

`CourseLibrary` already renders an unverified state. So an importer sets
`source: "imported"`, leaves `verifiedAt` null, and everything downstream
behaves correctly on day one. **Do not add an `importedFrom` flag or a second
verified boolean.**

## Ajay's addition: the card must be overwritable

**Every imported value must be editable, and correcting one is not an error
state.** Clubs re-index their holes, rebuild a tee, and rate a new set — a
card that was right last season can be wrong now, and the source is a
community database that can simply be wrong.

Two things follow:

1. **Editing an imported card is ordinary.** It should not require deleting and
   re-adding the course, and it should not warn as though the user is breaking
   something.
2. **A human edit outranks the source.** Once somebody has corrected a hole, a
   later re-import must not silently overwrite it. Whether re-import is offered
   at all is a decision; if it is, it needs to say what it will change before it
   changes it — the same "refuse and explain" idiom as `drawReadiness`.

The natural reading of the existing model: editing an imported card is what
sets `verifiedAt`. A human has looked at it, so it is no longer unverified. That
also gives re-import an honest rule — never touch a verified card without
asking.

## Three conditions on any importer

1. **Validate the stroke index, always.** `Course.strokeIndex` carries the
   warning that a wrong one *"allocates handicap shots to the wrong holes for
   the life of the course"*. Pebble Beach checked out — a clean 1–18
   permutation, pars summing to the course par — but that must be asserted on
   every card ingested, not assumed. A card failing the check should be refused
   with the reason, not imported and quietly wrong.
2. **Carry the attribution.** ODbL 1.0 permits commercial use *with
   attribution*; the response supplies `_attribution` — "© OpenStreetMap
   contributors (ODbL 1.0) via OpenGolfAPI". That is a licence obligation, so it
   has to appear on screen where the course is shown, not buried.
3. **Fall back outside the US.** Coverage is ~16,800 **US** courses. A UK or
   Irish club gets nothing, so manual entry and the existing paste-a-card path
   stay first-class. Import is an accelerator, never the only way in.

## Alternatives, if international coverage is wanted

| | Coverage | Free tier | Notes |
| --- | --- | --- | --- |
| **OpenGolfAPI** | ~16.8k, US only | Unlimited, keyless | ODbL, attribution required |
| **GolfCourseAPI** | ~30k worldwide | 50 requests/day | Enough for one-off imports; $9.99/mo for 10k/day |
| **golfapi.io** | 40k+, 160 countries | Paid | The commercial option |

50 requests a day is genuinely workable here: a club imports its course ONCE
and the row is stored. It is useless for anything live, which we do not need.

## Handicaps: there is no free source, and there will not be one

WHS handicap records are held by national associations — GHIN in the US, CONGU
in the UK — and are private, per-golfer, licence-gated data. GHIN access
requires a commercial agreement with the USGA and an association relationship.
Nobody can hand out a golfer's index for free.

This makes `docs/requirement-per-round-handicap.md` right as written: **the
member's handicap on the roster is the DEFAULT, unless a GHIN interface supplies
one.** Manual entry is not a stopgap; it is the correct primary source for
everyone outside a federated association.

**One thing to be careful of.** OpenGolfAPI also offers "OpenGolf ID", a
portable identity carrying handicap and scoring history, described as *"signed
and Bitcoin-anchored"*. That is **not a WHS handicap** and must never be
presented as one. A self-asserted index on a competition scorecard is a
different thing from a licensed one, and a club would be right to reject it. If
that identity layer is ever used, it is a convenience for casual play only, and
the screen has to say which kind of number it is showing.

## Why this is worth doing

It removes the "Add your course" step from a US club's setup checklist — the
one step the Demo Cup still has outstanding — and it fills the exact fields the
app already has, with the one field free sources usually lack. Free, keyless,
and it fails safe: an unverified card is already a state this app models.
