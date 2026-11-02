# Country words: what golfers call things, country by country

Ajay, 2026-10-24: "we are using societies a lot. in US its Leagues. We need to represent all
geographies", and "my US websites mentions Society and not league".

This is the table the golf pro and the marketing manager agreed. The code is
`src/lib/domain/golf-terms.ts`: `GOLF_TERMS` holds these words and `golfTermsFor(register)` gives
a screen its club's set. `golf-terms.test.ts` types this table out again by hand, country by
country, so the document and the code cannot agree by accident. `country-words.test.ts` refuses any
of these words typed into a screen.

Read on 2026-10-24. Where a country splits, the table says so.

## The table

| Concept | US | Canada | UK | Ireland | Australia | New Zealand | South Africa |
|---|---|---|---|---|---|---|---|
| The group that runs regular golf | league; golf group | league | society | society | social club; society | social club; society | society; golf group |
| The organized day out | outing | tournament; outing | society day; away day | society outing | golf day | golf day | golf day |
| Charity event | charity outing; charity tournament | charity golf tournament | charity day; charity golf day | golf classic | charity golf day | charity golf day | charity golf day |
| The casual group of four | foursome | foursome | fourball | fourball | fourball; group | fourball; group | fourball |
| Motorised golf car | cart | cart | buggy | buggy | cart (motorised cart) | cart | golf cart |
| The pull trolley | push cart; pull cart | push cart | trolley | trolley | buggy; pull buggy | trundler | trolley |
| One event | tournament | tournament | competition | competition | competition; comp | competition | competition |
| A stroke-play day, as named | stroke play | stroke play | medal | medal | stroke; monthly medal | stroke; medal | medal; stroke play |
| The person running it | organizer | organizer | organiser | organiser | organiser | organiser | organiser |
| The board of champions | honors board; champions board | honours board | honours board | honours board | honours board | honours board | honours board |
| Annual days | club championship, member-guest, member-member, invitational | club championship, member-guest | club championship, captain's day, the Open | club championship, captain's day, captain's prize | club championship, captain's day | club championship, captain's day | club championship, captain's day |

### Notes

- **"Fourball" is two things in Britain and South Africa.** Unhyphenated and lower case it is the
  group of four on the tee ("we're a fourball at 8.10"; South African golf days are priced "per
  fourball"). **Four-Ball** is also the Rules of Golf format, better ball of two pairs. The table
  holds the group only. The format keeps its Rules name in every country.
- **"Foursomes" is two things the other way round.** In the US a foursome is the group of four. In
  the Rules it is alternate shot. The app writes the group as `{group}`, so a US club reads
  "foursome" and a British one "fourball". The format is always **Foursomes**.
- **An Australian "buggy" is often the trolley you pull.** Australian clubs say "motorised cart" or
  "cart hire" for the car and "pull buggy" for the trolley; NSW's road rules call the car a "golf
  buggy". A New Zealander pulls a "trundler". So the southern hemisphere rides in a **cart**.
- **Ireland says "outing".** Irish societies hold a society *outing*, and an Irish charity event is a
  *golf classic*. The app gives Ireland the UK register ("society day", "charity day"). Irish
  golfers understand both, and the difference is not worth a fourth register.
- **Canada splits on one word.** Canada plays US golf: leagues, carts, foursomes, tournaments. It
  spells "honours", as Golf Canada does. The app gives Canada the US register, so a Canadian club
  reads "honors board". That one word is the cost of not having a fourth register for Canada.
- **Australia and New Zealand call a scramble "Ambrose".** That is a format name, so it is not in
  this table. Formats keep their Rules names; see "Format names never change" below.
- **Annual days are the club's own names.** A US club's member-guest and a British club's captain's
  day are names a club gives its own event. The app does not translate them. An organizer can name
  each tournament with any word from `PLAY_KINDS` (Tournament, Competition, Outing, Charity day,
  Society day…), and every country's words are offered there on purpose.
- **"Tournament" stays the app's word everywhere.** A British club calls one day a competition and
  understands "tournament". "Tournament" names the thing the app is built around: its menu, its
  screens, its help and its addresses. Swapping it would rename the product for half its clubs. A
  club that wants "Competition" on a tournament chooses it as that tournament's word (`PLAY_KINDS`).

## The registers: why there are three

Two registers, US and UK, were enough for Britain and the US. They got the southern hemisphere
wrong in three words:

| Word | uk (GB, IE, eurozone) | au (AU, NZ, ZA) |
|---|---|---|
| motorised golf car | buggy | cart |
| the day out | society day | golf day |
| charity event | charity day | charity golf day |
| a stroke-play day | medal | stroke |

Everything else is shared: fourball, organiser, society, honours. So `au` is a small register that
follows the same pattern. It is three words away from `uk`, and `golf-terms.test.ts` holds it to
eight differences at most. Canada stays on `us` (see the note above).

| Register | Countries | Picked as |
|---|---|---|
| `us` | US, Canada, and anywhere unknown or unlisted (Ajay's default, 2026-09-27) | "US golf terms — cart, foursome, league, outing" |
| `uk` | GB (with England, Scotland, Wales, Northern Ireland), Ireland, the eurozone | "UK and Irish golf terms — buggy, fourball, society, society day" |
| `au` | Australia, New Zealand, South Africa | "Australian, New Zealand and South African golf terms — cart, fourball, golf day" |

A club's own choice beats its country: `Organization.golfTerms`, on Club settings → Name &
branding → Golf words. The column already existed, so no migration was needed. It now accepts
`au` as well.

**The community's name follows the register too.** A community with no name of its own takes
`GOLF_TERMS.community`: a US or Canadian group is a league, and everyone else is a society.
`org-profile.ts` used to keep its own list, with the US alone as a league and a blank country as a
society. Since 2026-10-24 **a community with no country is a league**, Ajay's US default, the same
as its carts and foursomes already were. The club can still name itself (society, league,
association), and that choice beats both.

## How a screen gets the words

- **On the server:** `golfTermsForEvent(eventId)`, `golfRegisterForEvent`,
  `golfRegisterForOrganization` (`services/organization.ts`).
- **In a client component:** `useGolfTerms()`. `GolfTermsProvider` is set in the console layout,
  in the player layout and on `/match/new`, from the same club the rest of the shell reads.
- **In a table of sentences** (the guide, the player's Help, the plan copy, the interest form):
  write a token, such as `{golfGroups}`, `{organizer}` or `{Outing}` (a capital gives a capital).
  Then the screen fills it with `guideInClubWords`, `helpInClubWords`, `planTagline` / `planBlurb`
  or `interestWords`. A token that is not a term stays visible, and `country-words.test.ts` refuses
  it.
- **On the front door and its pages** (`/`, `/faq`, `/privacy`, `/terms`, `/interest`): write
  US words. The edition's swaps (`landing/edition.ts`) turn them into the visitor's, and they read
  `golfTermsFor` to do it. An AU, NZ or ZA visitor now gets the `au` words ("carts", "golf days").

## Format names never change

Foursomes, Four-Ball, Greensomes, Scramble and Stableford are the Rules of Golf's names, in every
register. `golf-terms.test.ts` refuses a format as a key or a value.

## What the guard does not see yet

- **"organizer" in the US spelling**, outside the guide and the Help. It appears about two
  thousand times, mostly in code and comments. The screens a person reads most were converted
  earlier (`golf-words-come-from-the-club.test.ts`); the rest of the console still spells it the US
  way to a British club. "organiser" typed by hand is refused everywhere.
- **"foursomes" in the plural**, which is also the format.
- **The two PDFs.** `/guide/tourneyhq-organizer-guide.pdf` is printed from a club with no country,
  so it is the US edition. The on-screen guide follows the club. `/guide/how-tourneyhq-works.pdf`
  was made by hand and is unchanged.

## Sources (read 2026-10-24)

- **United States.** "Golf outing" planning, foursomes and charity events:
  Bowling Green Golf Club, https://www.bowlinggreengolf.com/?p=1442; Momentive,
  https://momentivesoftware.com/blog/charity-golf-tournament/. Leagues under the USGA's handicap
  system: Park City Women's Golf Association nine-hole league by-laws,
  https://parkcity.gov/home/showpublisheddocument/73424/638173227886830000.
- **Canada.** Golf Canada's National Golf League ("existing recreational leagues"), via BC Golf:
  https://archive.britishcolumbiagolf.org/news/from-across-canada?start=220. Golf Canada spells
  "honourees": https://www.golfcanada.ca/articles/golf-canada-recognize-three-honourees-distinguished-service-award/.
- **United Kingdom.** Society days, buggy hire and fourballs: Formby Hall,
  https://www.formbyhallgolfresort.co.uk/golf/summer-golf/; Oxford Golf Club societies,
  https://www.oxfordgolfclub.co.uk/visitors/societies/; Today's Golfer, best golf society venues
  (15,000 societies across the UK and Ireland, a fourball's "away day"),
  https://www.todays-golfer.com/courses/best/golf-society-venues-and-courses-in-the-uk;
  National Club Golfer society golf,
  https://www.nationalclubgolfer.com/ncgsocietygolf/society/society-of-the-month-february-2024.
  We found no England Golf page on societies.
- **Ireland.** Society outings: TU Dublin Golf Society,
  https://www.tudublin.ie/explore/about-the-university/sustainability/about/news-and-events/tu-dublin-golf-society-outing-2026-at-baltinglass-golf-club.php.
  The golf classic: MS Ireland, https://www.ms-society.ie/events/information-event/intel-ireland-golf-classic.
- **Australia.** Social golf clubs: Australian Golf Digest,
  https://www.australiangolfdigest.com.au/the-social-movement/; Aussie Golfer (Golf Australia
  figures), https://aussiegolfer.com.au/decline-in-golf-club-membership-is-slowing-social-club-golfers-on-the-rise.
  Motorised carts: Brisbane Golf Club,
  https://brisbanegolfclub.com.au/motorised-cart-membership-expression-of-interest/; NSW Government,
  golf buggy vehicle sheet,
  https://www.nsw.gov.au/driving-boating-and-transport/vehicle-registration/conditional-and-seasonal/vehicle-sheets/golf-buggy.
  Corporate and charity golf days: Long Reef Golf Club,
  https://longreefgolfclub.com.au/wp-content/uploads/2021/03/2021-Corporate-Charity-Golf-Packages_2021.pdf;
  Carnarvon Golf Club, https://carnarvongolf.com.au/corporate.
- **New Zealand.** Trundlers and carts as separate hire: Waiheke Golf Club,
  https://www.newzealand.com/in/plan/business/waiheke-golf-club/; Hamilton Golf Club,
  https://www.newzealand.com/in/plan/business/hamilton-golf-club-at-st-andrews/. A charity golf day
  played as Ambrose: Rangitoto College, https://community.rangitoto.school.nz/event/GolfDay.
- **South Africa.** Golf days priced per fourball, golf carts booked separately: SAIOSH,
  https://www.saiosh.co.za/news/469513/Saiosh-Corporate-Health-and-Safety-Golf-Day---2019.htm;
  European Chambers golf day,
  https://www.fsacci.com/events/upcoming-events/e/event/european-chambers-golf-day-fourball-invitation.html;
  The Country Club Johannesburg, corporate package,
  https://thecountryclub.co.za/media/Golf%20Day/Corporate%20Package%202023.pdf.

Most of these are club pages and golf media. Of the national bodies, only Golf Canada had a page
that showed its own usage. The next pass should add national-body pages where they exist, such as
England Golf on societies and Golf Australia on social clubs.
