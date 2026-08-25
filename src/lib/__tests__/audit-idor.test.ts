import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Does an action check that the row it was handed belongs to the caller?
 *
 * A guard proves the caller is *an* organizer. It says nothing about whether
 * they organize the tournament whose stage id they just posted. Every export
 * in these files is a public HTTP endpoint taking arguments straight off the
 * wire, so an id parameter is an attacker-chosen row until something narrows
 * it — and the failure is invisible in the happy path, because the real UI
 * only ever sends ids the caller does own.
 *
 * The rule enforced here is structural: an action that accepts a row id must
 * either look it up with a scope key in the same where clause, or compare the
 * row's own eventId/organizationId afterwards. Structural rather than
 * behavioural because behaviour can only test the cases someone thought of,
 * and this catches the next action written as well as the ones here now.
 *
 * The rule is applied **per parameter**, which it was not originally. Asking
 * only "does this body scope something" passes an action that scopes one id
 * and trusts the next one, and that is not a hypothetical: `saveScorecard`
 * checked whose card it was and never checked which tournament the round came
 * from, while its upsert keyed on (stageId, playerId) — so a staff member of
 * any event could overwrite another club's card, and this file said it was
 * fine.
 */

const ACTIONS_DIR = join(process.cwd(), "src", "app", "actions");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

interface Action {
  file: string;
  name: string;
  params: string;
  body: string;
}

/** The balanced `(...)` starting at `open`, contents only. */
function parenGroup(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

function actionsIn(file: string): Action[] {
  const src = stripComments(readFileSync(join(ACTIONS_DIR, file), "utf8"));
  const out: Action[] = [];
  // The parameter list is brace-matched rather than read up to the first `):`.
  // An action with no return-type annotation — `removeSignup(playerId: string)`
  // — has no `):` to stop at, so the lazy version ran on into the *next*
  // function's signature and audited each against the other's arguments.
  const re = /export async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const next = src.indexOf("\nexport ", m.index + 1);
    out.push({
      file,
      name: m[1],
      params: parenGroup(src, m.index + m[0].length - 1),
      body: src.slice(m.index, next === -1 ? undefined : next),
    });
  }
  return out;
}

/**
 * Parameter names that identify a row the caller does not necessarily own.
 *
 * This list is coverage. A row type missing from it is not reported as safe —
 * it is not looked at, which is worse, because the suite still passes and
 * reads as if it checked. That is not hypothetical: `contest`, `expense`,
 * `settlement`, `sideGame` and `thread` were all absent while their actions
 * were being written, so the money stack and messaging were both outside the
 * sweep the whole time they were built.
 *
 * Anything added to the schema that an action can take by id belongs here the
 * same day.
 */
const ROW_ID =
  /^\w*(stage|match|player|team|course|tee|series|member|account|event|flight|prize|group|announcement|card|organization|winner|contest|expense|settlement|sideGame|pot|thread|message)Ids?$/i;

function rowIdParams(a: Action): string[] {
  return [...a.params.matchAll(/(\w+)\s*[?]?\s*:\s*string(\[\])?/g)]
    .map((m) => m[1])
    .filter((n) => ROW_ID.test(n));
}

const has = (text: string, name: string) => new RegExp(`\\b${name}\\b`).test(text);

/**
 * Every balanced `{...}` that follows a `where:` in this body.
 *
 * Brace-matched rather than a fixed character window, because the window was
 * how the original check went wrong: 240 characters after `where:` swept up
 * the `create:` branch of the upsert below it, found the `eventId` being
 * written there, and called the write scoped. A key in `create` decorates a
 * new row; it constrains nothing about which row an upsert lands on.
 */
function whereClauses(body: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = body.indexOf("where:", i)) !== -1) {
    const open = body.indexOf("{", i + 6);
    if (open === -1) break;
    let depth = 0;
    let j = open;
    for (; j < body.length; j += 1) {
      if (body[j] === "{") depth += 1;
      else if (body[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(body.slice(open, j + 1));
    i = j + 1;
  }
  return out;
}

/** Keys that are the caller's own scope rather than something they sent. */
const SCOPE_KEY = /\b(eventId|organizationId|userId|session\.email)\b/;

/**
 * Whether ONE id parameter is narrowed to something the caller owns.
 *
 * Three shapes count, and they are the three the codebase actually uses:
 *
 *   - the id sits in a `where` clause that also carries a scope key, or an id
 *     already established as scoped (`{ id: teeId, courseId }`, where
 *     `courseId` was itself resolved against the organization);
 *   - the row is fetched by this id and its own eventId/organizationId is
 *     compared afterwards — `stageInEvent`'s pattern, written out inline;
 *   - the id is handed to a helper whose job is to assert exactly this
 *     (`assertOwnMatch`, `assertEventStage`, `stageInEvent`, `effectiveAccess`,
 *     or a `require*Access`).
 *
 * That last shape is a NAME being trusted to do a job, which is only worth
 * anything while the named thing actually does it. `requirePotAccess` is
 * covered by its own test below, so widening this pattern did not quietly
 * turn it into a way to opt out by choosing a filename.
 */
function isParamScoped(body: string, param: string, alreadyScoped: string[]): boolean {
  const clauses = whereClauses(body);
  // The id appears anywhere in a where clause that also carries a scope key —
  // `{ id: stageId, eventId }`, but equally `{ eventId, courseId }`, which
  // asks whether that course is one of this tournament's venues.
  const inScopedWhere = clauses.some((w) => has(w, param) && SCOPE_KEY.test(w));
  // Or the clause looks this row up BY the id and constrains it with another
  // id already proven scoped: `{ id: teeId, courseId }`. Deliberately narrower
  // than the rule above — it must be the row being selected, not merely a
  // co-occurrence, or a composite key like `{ stageId_playerId: { stageId,
  // playerId } }` would launder one scoped id into vouching for the other.
  const targetsParam = new RegExp(`\\bid:\\s*(\\{\\s*in:\\s*)?${param}\\b`);
  const inScopedWhereVia = clauses.some(
    (w) => targetsParam.test(w) && alreadyScoped.some((other) => other !== param && has(w, other)),
  );
  const fetchedThenCompared =
    new RegExp(`where:\\s*\\{\\s*id:\\s*${param}\\b`).test(body) &&
    /\.(eventId|organizationId)\s*(!==|===)/.test(body);
  const handedToAssertion = new RegExp(
    `\\b(assert\\w+|\\w+InEvent|effectiveAccess|require\\w*Access)\\s*\\([^)]*\\b${param}\\b`,
  ).test(body);
  // Or it is tested for membership of a set built from a scoped query — how
  // the bulk paths narrow ids they receive by the hundred rather than issuing
  // a lookup per row: `field.has(row.playerId)` in importScores, where `field`
  // is this event's confirmed entries.
  const inOwnSet = new RegExp(`\\b\\w+\\.has\\(\\s*\\w*\\.?${param}\\b`).test(body);
  return inScopedWhere || inScopedWhereVia || fetchedThenCompared || handedToAssertion || inOwnSet;
}

/**
 * Ids scoped only by way of another id in the same action are resolved by
 * repeating the pass until nothing new is proven — `saveTee(courseId, teeId)`
 * needs `courseId` settled before `{ id: teeId, courseId }` means anything.
 */
function unscopedParams(a: Action): string[] {
  const ids = rowIdParams(a);
  const scoped: string[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of ids) {
      if (scoped.includes(id)) continue;
      if (isParamScoped(a.body, id, scoped)) {
        scoped.push(id);
        grew = true;
      }
    }
  }
  return ids.filter((id) => !scoped.includes(id));
}

/**
 * Ids that legitimately need no ownership check of their own, each with the
 * reason. Anything added here is a deliberate decision on the record — an
 * unexplained entry is how this test would quietly stop protecting anything.
 *
 * Keyed `file:action:param` where the exemption is about one argument, and
 * `file:action` where the whole action is pre-authorization.
 */
const EXEMPT: Record<string, string> = {
  "messaging.ts:readThread:threadId":
    "threadView(ctx, threadId) selects with { id, organizationId, scopeKey: { in: visibleScopes(ctx) } } in ONE where clause — the id narrows within the caller's derived scope set rather than authorising anything, and a thread outside it returns null; the scope check is one frame down",
  "messaging.ts:markThreadRead:threadId":
    "calls threadView first and returns without writing when it is null, so the watermark can only ever be moved on a thread the same derived-scope query already returned",
  "auth.ts:signInWithPassword": "pre-auth by definition; resolves its own scope from credentials",
  "auth.ts:claimPassword": "pre-auth; the token is the authorization",
  "auth.ts:resetPassword": "pre-auth; the token is the authorization",
  "auth.ts:signUp": "pre-auth; creates the scope rather than entering one",
  "play.ts:redeemRoundCode": "the code IS the credential; rate limited separately",
  "play.ts:claimPlayerSlot": "same code-based auth, same shared rate limit",
  "teams.ts:removeTeamMember:playerId":
    "the delete is bounded by teamId, which is scoped; a foreign playerId can only fail to match a row inside this event's team",
  "tournament.ts:removeSignups:playerIds":
    "a loop over removeSignup, which refuses any player whose eventId isn't the caller's — the scope check is one frame down",
  "tournament.ts:generateNextRound:stageId":
    "a thin call to generateCutRound(eventId, stageId), which bails unless the stage's own eventId matches the caller's — the scope check is one frame down",
  "tournament.ts:clearRoundScores:playerIds":
    "never selects a row, only narrows one: every delete is already bounded by { eventId, stageId }, and the ids just shrink that set further — a foreign id matches nothing",
  "tournament.ts:saveTeamScorecard:playerId":
    "narrowed by membership instead of by event: team.members.some(m => m.playerId === playerId), on a team already proven to be this event's",
  "tournament.ts:setBracketWinner:winnerId":
    "a slot label written into this event's own BracketWinner row, never used as a lookup key — the bracket only ever compares it against its own slots, so a foreign id renders as nothing",
  "side-games.ts:confirmSideGameEntry:playerId":
    "same shape as confirmContestEntry: the lookup is the composite key (sideGameId, playerId) on a side game already proved to be in this event, so a foreign playerId matches no entry",
  "contests.ts:confirmContestEntry:playerId":
    "never selects a row on its own: the lookup is the composite key (contestId, playerId) on a contest already proved to be in this event, so a foreign playerId can only fail to match an entry inside it",
  "contests.ts:setContestEntrants:playerIds":
    "narrowed one frame down by fieldIds(eventId, ids), which re-queries every id against this event's Player rows and returns only the ones that are really in the field — an invented id simply is not in the result",
  "contests.ts:setContestWinners:winnerIds":
    "same fieldIds(eventId, ids) narrowing: a winner is only recorded for a player this tournament actually has, so a stranger's id cannot be handed a pot",
  "tournament.ts:setPrizeWinner:winnerId":
    "same shape: stored on this event's own Prize row and only ever matched against this event's field",
};

describe("no action trusts a row id it was handed", () => {
  const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"));

  it("finds the action files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("finds actions that take row ids at all", () => {
    // If the parser broke, every assertion below would pass vacuously.
    const withIds = files.flatMap(actionsIn).filter((a) => rowIdParams(a).length > 0);
    expect(withIds.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    it(`${file} — every row id is narrowed to the caller's scope`, () => {
      for (const a of actionsIn(file)) {
        if (EXEMPT[`${file}:${a.name}`]) continue;
        const open = unscopedParams(a).filter((p) => !EXEMPT[`${file}:${a.name}:${p}`]);
        expect(
          open,
          `${file}:${a.name} accepts ${open.join(", ")} without checking it belongs to the caller`,
        ).toEqual([]);
      }
    });
  }

  it("would still fail on the hole it was written for", () => {
    // The check has to be able to fail, and specifically on this shape: one id
    // checked, the next one trusted, with a composite-key upsert carrying an
    // eventId in its `create` branch that looks like scoping and isn't.
    const regressed: Action = {
      file: "fake.ts",
      name: "saveScorecard",
      params: "stageId: string, playerId: string",
      body: `
        const { eventId, session } = await requireScoreEntry();
        await assertOwnCard(session, eventId, playerId);
        await prisma.scorecard.upsert({
          where: { stageId_playerId: { stageId, playerId } },
          update: { strokes },
          create: { eventId, stageId, playerId, strokes },
        });`,
    };
    expect(unscopedParams(regressed)).toEqual(["stageId"]);
  });

  it("keeps every exemption explained", () => {
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${key} needs a real reason`).toBeGreaterThan(20);
      const [file, name, param] = key.split(":");
      const action = actionsIn(file).find((a) => a.name === name);
      expect(!!action, `${key} is exempted but no longer exists — remove it`).toBe(true);
      if (param) {
        // An exemption for an argument that is now scoped (or gone) is dead
        // weight that hides the next one.
        expect(
          rowIdParams(action!).includes(param),
          `${key} names an argument ${name} no longer takes — remove it`,
        ).toBe(true);
        expect(
          unscopedParams(action!).includes(param),
          `${key} is scoped now — remove the exemption`,
        ).toBe(true);
      }
    }
  });
});

describe("the club theme cannot inject CSS", () => {
  // saveOrganizationTheme stores a hex a club typed, and the layout renders the
  // theme through dangerouslySetInnerHTML. The hex never reaches the output —
  // themeCss regenerates every value — but both halves of that need pinning.
  const themes = readFileSync(join(process.cwd(), "src", "lib", "themes.ts"), "utf8");
  const layout = readFileSync(
    join(process.cwd(), "src", "app", "(app)", "layout.tsx"),
    "utf8",
  );

  it("filters every emitted declaration through a value whitelist", () => {
    expect(themes).toMatch(/SAFE_CSS_VALUE/);
    expect(themes).toMatch(/\.filter\(\(\[, v\]\) => SAFE_CSS_VALUE\.test\(v\)\)/);
  });

  it("renders the theme from themeCss and nothing else", () => {
    // A stylesheet built anywhere but themeCss would skip the whitelist.
    expect(layout).toMatch(/dangerouslySetInnerHTML=\{\{ __html: themeStyleSheet \}\}/);
    expect(layout).toMatch(/const themeStyleSheet = themeCss\(/);
  });

  it("validates both colours and the appearance on save", () => {
    const org = stripComments(
      readFileSync(join(ACTIONS_DIR, "organization.ts"), "utf8"),
    );
    const body = org.slice(org.indexOf("export async function saveOrganizationTheme"));
    expect(body).toMatch(/hexToHsl\(themeHex\)/);
    expect(body).toMatch(/hexToHsl\(secondaryHex\)/);
    expect(body).toMatch(/isThemeKey\(themeKey\)/);
    expect(body).toMatch(/SECONDARY_PRESETS\.some/);
    expect(body).toMatch(/isAppearance\(appearance\)/);
    // And it is still an organizer-only write.
    expect(body).toMatch(/org\.canEdit/);
  });
});

/**
 * The helper the IDOR sweep now trusts by name.
 *
 * `isParamScoped` accepts an id as scoped when it is handed to a
 * `require*Access` helper. That is a name vouching for a behaviour, and a name
 * is worth nothing on its own — so the behaviour is pinned here.
 *
 * `requirePotAccess` widened who may write a skins pot: a fourball's own game
 * can be set up by any player in that fourball, without the organizer. That is
 * a deliberate loosening, and it is only safe while all four of these hold. If
 * any one goes, a player can reach another group's money.
 */
describe("requirePotAccess is a real check, not a reassuring name", () => {
  const src = readFileSync(join(ACTIONS_DIR, "skins.ts"), "utf8");
  const start = src.indexOf("async function requirePotAccess");
  // Bounded by the next top-level declaration rather than by a brace pattern:
  // matching "\n}\n" depends on the file's line endings, and on CRLF it found
  // nothing and silently sliced the body down to one character — a test that
  // passes vacuously is worse than one that fails.
  const after = src.indexOf("\nexport ", start);
  const fn = start === -1 ? "" : src.slice(start, after === -1 ? undefined : after);

  it("exists at all", () => {
    expect(start, "requirePotAccess has been renamed or removed").toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(200);
  });

  it("proves the round belongs to the caller's tournament", () => {
    // Without this the group check below is asked about a stage in somebody
    // else's event, and would happily pass for a group name that matches.
    expect(fn).toMatch(/stageInEvent\(\s*eventId\s*,\s*stageId\s*\)/);
  });

  it("keeps the FIELD's pot organizer-only", () => {
    // An empty groupKey is the tournament's own money. Players get their own
    // group's game, not the club's.
    expect(fn).toMatch(/if\s*\(!key\)\s*throw/);
  });

  it("reads group membership from the tee sheet, never from the caller", () => {
    // The group name arrives over HTTP. What must NOT arrive over HTTP is who
    // is in it — otherwise a caller names any group and claims to be in it.
    expect(fn).toMatch(/parseTeeSheet\(/);
    expect(fn).toMatch(/group\?\.playerIds\.includes\(me\.id\)/);
  });

  it("resolves the caller from the session, not from a parameter", () => {
    // `me` comes from the signed-in email against this event's players. A
    // playerId parameter here would let anyone act as anyone.
    expect(fn).toMatch(/session\.email/);
    expect(fn).toMatch(/prisma\.player\.findFirst\(/);
    // No playerId PARAMETER. `e.playerId` reading the pot's own entrant rows
    // is the opposite of the danger — a fact from the database rather than a
    // claim from the caller — so the check is for a parameter position.
    expect(fn).not.toMatch(/\(\s*playerId\s*[,:)]/);
  });
});

/**
 * The third branch of requirePotAccess: a bet that is nobody's group.
 *
 * Six friends across three fourballs agree a game on the first tee. That is
 * neither the club's pot nor any one group's, so it is stored under a name
 * they chose — and the access rule cannot be "is this a tee-sheet group",
 * because it deliberately is not one.
 *
 * The rule is instead about the pot's own membership, and it is pinned here
 * because it is the one place a player can write money into a pot the tee
 * sheet does not vouch for.
 */
describe("an ad-hoc side bet is still somebody's, not everybody's", () => {
  const src = readFileSync(join(ACTIONS_DIR, "skins.ts"), "utf8");
  const start = src.indexOf("async function requirePotAccess");
  const after = src.indexOf("\nexport ", start);
  const fn = start === -1 ? "" : src.slice(start, after === -1 ? undefined : after);

  it("still resolves the caller from the session before anything else", () => {
    // The ad-hoc branch sits AFTER the caller has been resolved to a real
    // player in this event. Reordering it above that would let a signed-in
    // stranger write a pot in a tournament they are not in.
    const meAt = fn.indexOf("prisma.player.findFirst");
    const adHocAt = fn.indexOf("skinsPot.findMany");
    expect(meAt).toBeGreaterThan(-1);
    expect(adHocAt).toBeGreaterThan(meAt);
  });

  it("checks the pot's own entrants, not the caller's word", () => {
    // Membership of an ad-hoc bet is the entrant rows, read from the database.
    // Across EVERY pot under this name on the round, not the first row found.
    // A name can carry four pots — front and back, gross and net — and
    // deciding access from whichever turned up first answered about a
    // different game than the one being written.
    expect(fn).toMatch(/skinsPot\.findMany/);
    expect(fn).toMatch(/entrants\.has\(me\.id\)/);
  });

  it("leaves an EMPTY pot open, and a populated one closed", () => {
    // The gap between creating a pot and naming its entrants is the one
    // moment nobody is in it. Closing that would make a bet impossible to
    // start; leaving it open once people ARE in it would let anyone re-price
    // or empty somebody else's game.
    expect(fn).toMatch(/entrants\.size === 0/);
    expect(fn).toMatch(/throw new Error\("Only somebody in this game can change it"\)/);
  });

  it("bounds the name rather than truncating it", () => {
    // The name is part of a unique key. Silently shortening two different
    // names to the same forty characters would merge two groups' money.
    expect(fn).toMatch(/key\.length > AD_HOC_NAME_MAX/);
    expect(src).not.toMatch(/groupKey.*\.slice\(0, ?AD_HOC_NAME_MAX\)/);
  });
});
