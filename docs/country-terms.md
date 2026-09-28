# Country-based wording and prices

Ajay, 2026-09-27: "local by default and overridden option for USD and US terminologies,
including currency and golf terminologies." Decided the same day:
- real local plan prices;
- the app itself goes country-based, not only the landing;
- US is the default wherever the country is unknown.

## What already existed

- **The club's country.** `Organization.country` is free text, normalised by
  `domain/country.ts` `countryCode()`. It is the club's answer about itself, never the
  signed-in person's.
- **One word already varied by country.** `org-profile.ts` `VOICE_BY_COUNTRY` sends the US
  to "league". It covers the community noun only, and `communityNoun` is the club's
  override.
- **Money and dates per club.** `Organization.currency` / `locale`, with a per-tournament
  override (`TournamentFormatting`).

## Stage 1: local plan prices (a separate PR)

- `PLAN_CURRENCIES`: USD, GBP, EUR, CAD, AUD, NZD, ZAR. Approved prices, monthly Season /
  Club; a year is 10× the month:

  | Currency | Season | Club  |
  |----------|--------|-------|
  | USD      | 49     | 175   |
  | GBP      | 39     | 139   |
  | EUR      | 45     | 159   |
  | CAD      | 65     | 239   |
  | AUD      | 75     | 269   |
  | NZD      | 79     | 289   |
  | ZAR      | 899    | 3,199 |

- `effectivePrice(plan, overrides, currency)`. An unknown currency resolves to USD.
- The Club settings plan panel quotes in the club's currency.
- These are display prices only: billing is not live.

## Stage 2: the terms table and the club's choice (this PR)

- **`domain/golf-terms.ts`**: `golfRegister(country, override)` returns `"us" | "uk"`.
  - UK: GB (including "Scotland", "England", "Wales" and "Northern Ireland", now mapped by
    `countryCode`), IE, AU, NZ, ZA and the eurozone.
  - Everything else, Canada included, is US. Blank or unknown is US.
- **`Organization.golfTerms`**: `""` follows the country; `"us"` or `"uk"` is the club's
  choice. Migration `84_golf_terms` is additive, and the empty default means no backfill.
- **Club settings**, "Golf words": the picker (`GolfTermsPicker`) and the action
  (`saveOrganizationGolfTerms`), with the owner/admin guard and validation, the same shape
  as the community noun.
- **Terms so far:**

  | Concept                | US            | UK           |
  |------------------------|---------------|--------------|
  | motorised golf car     | cart / carts  | buggy / buggies |
  | the group you play with | foursome(s)  | fourball(s)  |
  | person running it      | organizer(s)  | organiser(s) |
  | a stroke-play day      | stroke play   | medal        |

- **FORMATS NEVER CHANGE.** UK "foursomes" is alternate shot; a US "foursome" is a group.
  The table holds the GROUP word only. Format names are the Rules of Golf's own, and
  `golf-terms.test.ts` pins that no format is a key.

## Stage 3: screens read the terms

Converted a screen at a time, the player app first. Each converted screen reads
`golfTermsFor(golfRegister(org.country, org.golfTerms))`, through `golfTermsForEvent` on a
server page. `golf-words-come-from-the-club.test.ts` pins that a converted file reaches the
terms and hard-codes none of the words it replaced; a file joins its list the day it is
converted.

Converted in this PR:

- `/me/board`: the three "your organizer" sentences.
- `/me/card`: the waiting-list line, "entered by the organizer", and who enters the card.
- `/me/money` (`MoneyClient`): the cart category label and total, the placeholder, the refund
  hint, the empty text, and "The organizers add the shared costs", together with the same
  sentence in `addExpense`'s refusal, so the form and the server say one thing.
- `/group-games`: "a fourball's own skins" / "a foursome's own skins".

Measured on the seeded club (country GB) by rendering `/group-games` as its secretary: blank
setting reads "fourball", "us" reads "foursome", "uk" reads "fourball"; setting restored.

Converted in the second PR:

- `/me` (Today): the waiting-list line and "not on the tee sheet yet".
- `EnterButton`'s reply ("The organiser will confirm…", "Sent to the organiser…"). The
  events list carries the word PER ROW (`ClubEventRow.organizer`), because a member's list
  can hold tournaments from clubs in two countries.
- `MessagesClient`, on both the player's and the console's Messages: the announcements-only
  line and the two message-settings sentences.
- `DeniedNotice`, in both shells: "is for the tournament's organiser".

A client component takes the word as a prop, and its default is the US word, so a caller
that forgets it would fail quietly. The sweep test therefore also pins that every caller
passes `organizer=`.

Measured: a member of the seeded GB club sent to `/me?denied=dashboard` reads "organiser";
with the club's setting on `us`, "organizer"; setting restored.

Still to convert:

- **The ROLE name "Organizer"** (`roles.ts`, `MobileTabBar`, `access-roles.ts`, the
  Access screen, the player header's button). It is one label used in a dozen places, so
  it changes everywhere at once or not at all; half-converted, a club would read both
  spellings of its own role.
- The console's remaining organizer wording, tee sheet and draw screens ("group" words).
- The landing, which is owned by the site session and keeps its own swap table.

## Out of scope unless asked

- Spelling beyond these words ("colour", "honours").
- Languages other than English.
- Re-rendering stored tournament date text.
- The handicap authority per country (`handicapAuthorityId` defaults to GHIN, which is a stub).
