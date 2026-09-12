# Local weather on the member screen

**Proposal, not a decision.** Written 2026-09-11 at Ajay's request: *"keep
thinking about local weather information if we have the geography and local
data, only on the member screen."*

The question has a factual half and a design half. The factual half first,
because it decides how much of this is possible today.

---

## What we actually have

Measured against the development database rather than assumed.

| | have it? | notes |
|---|---|---|
| **A date for the round** | **yes** | `Stage.playedOn` is a real ISO date string (`"2026-05-19"`), deliberately a calendar day rather than a timestamp. Empty means no fixed day — 4 of 11 stages have one here. |
| **A place, as text** | **mostly** | `Course.city` (4/4 rows), `Course.address` (3/4). The catalogue is patchier: 1,843 of 2,469 have a city, 1,471 an address. |
| **Coordinates** | **no** | Nothing in the schema has latitude or longitude — not `Course`, not `CourseCatalog`, not `Event`. |
| **A timezone** | **no** | No column anywhere. |

So: **we have the day and roughly where, and we do not have the two things a
weather API actually takes.** That gap is the whole of the work.

### The one thing that is NOT a blocker

`playedOn` being a string looked like a problem and is not — it is an ISO date
by contract, and the comment on the column explains why it is stored that way
(a calendar day, so a club in one timezone does not see "Mon 18 May" for a
round everyone played on Tuesday). It parses straight into a forecast query.

---

## Getting coordinates without asking for coordinates

`schema.prisma` already says the right thing about this, about the club's own
address: *"asking a golf secretary for coordinates would be asking the wrong
question."* That still holds. Nobody types a latitude.

So they get **geocoded from the address we already collect**, once per course,
and stored. Open-Meteo's geocoding endpoint is free and needs no key, which
matters here — the course catalogue import is already rationed at 500 requests
a day against a different API, and this repo has been bitten by quota before.

Two nullable columns on `Course` (`lat`, `lon`), filled lazily the first time a
round at that course needs a forecast, and never re-fetched. A course whose
address does not geocode stays null for ever and simply has no weather, which
is the correct failure.

---

## What to show, and to whom

**Only the member screens** — `/me` and `/me/card` — as asked. The organizer
console is not the place: an organizer deciding whether to move a round wants a
five-day view and a decision, which is a different feature with different
stakes. A player wants to know what to expect walking to the first tee.

**Wind first.** Temperature is comfort; rain is a coat; *wind is the only one
that changes the golf* — club selection, where you aim, whether a front pin is
reachable. A forecast card that leads with 18°C and buries "22 mph SW" has the
emphasis backwards for the audience it is written for.

So, for the round's own day: wind speed and direction, chance of rain,
temperature. Three numbers, one line.

---

## When there is no forecast, say why

Added 2026-09-11, and it corrects the first draft of this document, which said
silence was the answer: *"if not available, ask user to add missing information
(except geolocation) or provide some kind of supporting info explaining why the
weather is not available."*

That is right, and it is the rule this repo already applies everywhere else — a
control that does not say why is a dead end, which is why the draw button
explains the empty field instead of disappearing. Silence on a weather card
reads as a broken feature.

But **who can act on it decides what to say**, and the two audiences are not the
same person:

| why there is no forecast | the member sees | the organizer sees |
|---|---|---|
| the course has no town on it | "No forecast — this course has no location set yet." | the ask, on the course form: add the town, and say it is what a forecast needs |
| the round has no date | "No forecast until the round has a date." | the ask, on the round: set the day it is played |
| too far out | "Too far out for a forecast — check back nearer the day." | nothing; this is not a fault |
| we could not place the course | "No forecast — we couldn't place this course." | the town field again, with what we tried |
| the service is down | "Forecast unavailable right now." | nothing |

**Never ask the member to fix the organizer's data.** A player opening their
card cannot edit a course record, and a message telling them to is worse than
silence — it is an instruction they cannot follow. They get the reason; the ask
goes where the field lives.

**And never ask anyone for coordinates or for their device location.** Excluded
explicitly. Coordinates are the wrong question for a golf secretary — the
schema already says so — and a browser geolocation prompt asks a player where
*they* are, which is not where the round is and is a permission dialog nobody
opened the app for.

## Five things it must never do

1. **Never break the card.** A forecast is decoration on a screen whose job is
   scoring. Every failure above renders one quiet line of text saying why —
   never an error, never a broken box, and never a retry the player has to
   drive.

2. **Never look like scoring data.** It sits on a screen full of numbers that
   decide money, and a temperature rendered in the same weight as a to-par is
   an invitation to misread. Visually subordinate, and clearly labelled as a
   forecast.

3. **Never fetch per player.** A fourball opening their cards is four requests
   for one course on one day. One fetch per course per day, cached and shared —
   the same reasoning the board cache already carries.

4. **Never claim a forecast it does not have.** Free forecast horizons run
   about 7–16 days. A club championship booked for June has no forecast in
   March, and the honest rendering of that is nothing at all rather than a
   seasonal average dressed as a prediction.

5. **Never become a reason not to play.** It reports; it does not advise, warn,
   or suggest postponing. Deciding whether a round goes ahead is the
   organizer's job and a matter of local knowledge — standing water, not wind
   speed.

---

## Cost, honestly

Open-Meteo is free for non-commercial use and needs no key; commercial use
wants a paid plan. **TourneyHQ is a commercial product**, so this is a real
line item and should be priced before it is built, not after. The alternatives
(OpenWeather, Tomorrow.io, WeatherAPI) all have free tiers with request caps
that one cached fetch per course per day would sit comfortably inside.

The caching design is what makes any of them affordable: a club playing weekly
at one course is ~52 forecast requests a year, not 52 × the size of the field.

---

## What I would do first

Not build it. **Geocode the courses we already have and see what lands** — the
same discipline the course-card rules demand: judge the real data read-only
before writing a guard against it. A throwaway script that geocodes the 1,471
catalogue rows with an address and prints how many resolve, and to what
accuracy, answers the only question that matters: whether "the geography we
have" is good enough to put a forecast on a player's screen without being wrong
about where they are playing.

If a meaningful share resolve to the wrong town, this stops here and the
feature needs the organizer to confirm the location — which is a different and
much larger ask.
