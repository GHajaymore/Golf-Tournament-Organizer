<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="_ds/nocturne-6909e6bb-44e9-47d2-bfb1-53782885cd38/styles.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css">
<style>
  body { margin: 0; background: var(--color-bg); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--color-neutral-800); border-radius: 6px; }
</style>
</helmet>

<sc-if value="{{ notLoggedIn }}" hint-placeholder-val="{{ true }}">
<div style="min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:radial-gradient(1000px 600px at 80% -120px, var(--color-accent-900), transparent 60%), var(--color-bg)">
  <div style="display:flex;flex-direction:column;justify-content:space-between;padding:48px 56px">
    <div style="display:flex;align-items:center;gap:10px;font-family:var(--font-heading);font-weight:500;font-size:19px">
      <i class="ph-fill ph-golf" style="color:var(--color-accent);font-size:24px"></i> Nocturne Golf
    </div>
    <div>
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent)">Tournament Operations</div>
      <h1 style="font-size:44px;line-height:1.08;margin:14px 0 0;max-width:12ch">Run the whole event from one console.</h1>
      <p class="text-muted" style="font-size:15px;max-width:44ch;margin-top:16px">Round-robin groups, qualification, brackets, match-play scorecards and live standings — automated, with manual override wherever you need it.</p>
    </div>
    <div class="text-muted" style="font-size:12px">Pilot build · v0.9 · Ridgeline National</div>
  </div>
  <div style="display:flex;align-items:center;justify-content:center;padding:40px;border-left:1px solid var(--color-divider)">
    <div style="width:min(400px,100%);display:flex;flex-direction:column;gap:16px">
      <div>
        <div class="text-muted" style="font-size:12px;letter-spacing:.1em;text-transform:uppercase">Organizer sign-in</div>
        <h3 style="margin:6px 0 0;font-size:22px">Choose an event to manage</h3>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <sc-for list="{{ events }}" as="evt" hint-placeholder-count="3">
          <button type="button" onClick="{{ evt.open }}" style="text-align:left;background:var(--color-surface);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px;cursor:pointer;color:var(--color-text);display:flex;justify-content:space-between;align-items:center;gap:12px" style-hover="border-color:var(--color-accent)">
            <span>
              <span style="display:block;font-family:var(--font-heading);font-weight:500;font-size:15px">{{ evt.name }}</span>
              <span class="text-muted" style="font-size:12px">{{ evt.meta }}</span>
            </span>
            <span class="tag {{ evt.tagClass }}">{{ evt.status }}</span>
          </button>
        </sc-for>
      </div>
      <div class="field"><label>Signed in as</label><input class="input" value="Alex Rourke · Head Organizer" readonly></div>
    </div>
  </div>
</div>
</sc-if>

<sc-if value="{{ loggedIn }}" hint-placeholder-val="{{ false }}">
<div style="display:flex;min-height:100vh;background:var(--color-bg);color:var(--color-text);font-family:var(--font-body)">
  <aside style="width:250px;flex:none;border-right:1px solid var(--color-divider);padding:16px 12px;display:flex;flex-direction:column;gap:2px;position:sticky;top:0;height:100vh;overflow:auto">
    <div style="display:flex;align-items:center;gap:9px;padding:6px 8px 12px;font-family:var(--font-heading);font-weight:500;font-size:16px">
      <i class="ph-fill ph-golf" style="color:var(--color-accent);font-size:21px"></i> Nocturne Golf
    </div>
    <sc-for list="{{ navSections }}" as="sec" hint-placeholder-count="4">
      <div style="font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--color-neutral-500);margin:12px 8px 3px">{{ sec.label }}</div>
      <sc-for list="{{ sec.items }}" as="it" hint-placeholder-count="3">
        <a onClick="{{ it.onClick }}" style="{{ it.style }}" style-hover="background:color-mix(in srgb, var(--color-text) 6%, transparent)"><i class="{{ it.icon }}" style="font-size:17px;width:20px"></i><span>{{ it.label }}</span></a>
      </sc-for>
    </sc-for>
    <div style="margin-top:auto;padding-top:12px;border-top:1px solid var(--color-divider);display:flex;flex-direction:column;gap:10px">
      <div>
        <div class="text-muted" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px">Viewing as</div>
        <div class="seg" style="width:100%"><label class="seg-opt"><input type="radio" name="roleview" checked="{{ isAdminRole }}" onChange="{{ setRoleAdmin }}">Organizer</label><label class="seg-opt"><input type="radio" name="roleview" checked="{{ isPlayerRole }}" onChange="{{ setRolePlayer }}">Player</label></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--color-accent-800);color:var(--color-accent-100);display:grid;place-items:center;font-size:12px;font-weight:600">{{ activeAccount.initials }}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px">{{ activeAccount.name }}</div>
          <div class="text-muted" style="font-size:11px">{{ activeAccount.roleLabel }}</div>
        </div>
        <button type="button" class="btn btn-icon" onClick="{{ logout }}" title="Sign out"><i class="ph ph-sign-out"></i></button>
      </div>
    </div>
  </aside>

  <main style="flex:1;min-width:0;padding:26px 30px;max-width:1220px">

    <!-- DASHBOARD -->
    <sc-if value="{{ show.dashboard }}" hint-placeholder-val="{{ true }}">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px">
        <div>
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">{{ ev.name }}</div>
          <h2 style="font-size:27px;margin:5px 0 0">Tournament dashboard</h2>
          <p class="text-muted" style="margin:6px 0 0;font-size:13px">{{ ev.dates }} · {{ ev.course }}, {{ ev.city }}</p>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-secondary" onClick="{{ goEntry }}"><i class="ph ph-pencil-simple"></i> Enter scores</button>
          <button type="button" class="btn btn-primary" onClick="{{ goLeaderboard }}"><i class="ph ph-ranking"></i> Leaderboard</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <sc-for list="{{ statCards }}" as="c" hint-placeholder-count="4">
          <div class="card elev-sm" style="gap:4px">
            <div style="display:flex;align-items:center;justify-content:space-between"><span class="card-kicker">{{ c.label }}</span><i class="{{ c.icon }}" style="color:var(--color-accent);font-size:16px"></i></div>
            <div style="font-family:var(--font-heading);font-weight:500;font-size:26px;line-height:1">{{ c.value }}</div>
            <div class="text-muted" style="font-size:12px">{{ c.sub }}</div>
          </div>
        </sc-for>
      </div>

      <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start">
        <div class="card elev-sm">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px"><span class="card-title">Live leaderboard</span><span class="text-muted" style="font-size:12px">Overall · all groups</span></div>
          <table class="table">
            <thead><tr><th style="width:36px">#</th><th>Player</th><th>Grp</th><th>Rec</th><th style="text-align:right">Holes ±</th><th style="text-align:right">Pts</th></tr></thead>
            <tbody>
              <sc-for list="{{ leaderTop }}" as="r" hint-placeholder-count="8">
                <tr>
                  <td><span style="{{ r.badge }}">{{ r.rank }}</span></td>
                  <td style="font-weight:500">{{ r.name }}</td>
                  <td class="text-muted">{{ r.group }}</td>
                  <td class="text-muted" style="font-variant-numeric:tabular-nums">{{ r.record }}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums">{{ r.diffText }}</td>
                  <td style="text-align:right;font-weight:600;color:var(--color-accent-200);font-variant-numeric:tabular-nums">{{ r.ptsText }}</td>
                </tr>
              </sc-for>
            </tbody>
          </table>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card elev-sm">
            <span class="card-title">Current stage</span>
            <div style="display:flex;align-items:center;gap:10px;margin-top:2px">
              <div style="width:40px;height:40px;border-radius:8px;background:var(--color-accent-900);display:grid;place-items:center;color:var(--color-accent-200)"><i class="ph ph-arrows-clockwise" style="font-size:20px"></i></div>
              <div><div style="font-weight:500">{{ stageName }}</div><div class="text-muted" style="font-size:12px">{{ stageSub }}</div></div>
            </div>
            <div style="margin-top:12px;height:8px;border-radius:6px;background:var(--color-neutral-800);overflow:hidden"><div style="height:100%;background:var(--color-accent);width:{{ pctText }}"></div></div>
            <div class="text-muted" style="font-size:12px;margin-top:6px">{{ matchesDoneText }} matches complete</div>
          </div>

          <div class="card elev-sm">
            <div style="display:flex;align-items:center;justify-content:space-between"><span class="card-title">Bracket status</span><span class="tag tag-neutral">Provisional</span></div>
            <div class="text-muted" style="font-size:12px;margin-top:-2px">Seeded from live group standings</div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
              <sc-for list="{{ bracketStatus }}" as="b" hint-placeholder-count="2">
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px"><span><i class="{{ b.icon }}" style="color:var(--color-accent);margin-right:6px"></i>{{ b.name }}</span><span class="text-muted">{{ b.detail }}</span></div>
              </sc-for>
            </div>
            <button type="button" class="btn btn-ghost" onClick="{{ goBracket }}" style="align-self:flex-start;margin-top:6px">Open bracket manager <i class="ph ph-arrow-right"></i></button>
          </div>

          <div class="card elev-sm">
            <div style="display:flex;align-items:center;justify-content:space-between"><span class="card-title">Qualification cutoff</span><span class="tag tag-accent">Top {{ qualPerGroup }}/group</span></div>
            <div style="font-family:var(--font-heading);font-size:22px;margin-top:2px">{{ qualCount }} <span class="text-muted" style="font-size:14px">of {{ playersCount }} advancing</span></div>
            <div class="text-muted" style="font-size:12px">Cutoff line ≈ {{ cutoffText }} pts · updates live with scores</div>
          </div>
        </div>
      </div>

      <div class="card elev-sm" style="margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between"><span class="card-title">Group standings</span><span class="text-muted" style="font-size:12px">Advancing rows highlighted</span></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:6px">
          <sc-for list="{{ groupsView }}" as="g" hint-placeholder-count="8">
            <div>
              <div style="font-size:12px;font-weight:600;margin-bottom:4px">{{ g.name }}</div>
              <sc-for list="{{ g.rows }}" as="r" hint-placeholder-count="4">
                <div style="{{ r.miniStyle }}"><span style="width:14px;color:var(--color-neutral-500)">{{ r.rank }}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.short }}</span><span style="font-weight:600;font-variant-numeric:tabular-nums">{{ r.ptsText }}</span></div>
              </sc-for>
            </div>
          </sc-for>
        </div>
      </div>
    </sc-if>

    <!-- EVENT SETUP -->
    <sc-if value="{{ show.event }}" hint-placeholder-val="{{ false }}">
      <div style="margin-bottom:20px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Setup</div><h2 style="font-size:27px;margin:5px 0 0">Event setup</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Core event details, venue and default match format.</p></div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;align-items:start">
        <div class="card elev-sm" style="gap:14px">
          <div class="field"><label>Event name</label><input class="input" value="{{ ev.name }}" onChange="{{ setEvName }}"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label>Dates</label><input class="input" value="{{ ev.dates }}" onChange="{{ setEvDates }}"></div>
            <div class="field"><label>Format</label>
              <div class="seg">
                <label class="seg-opt"><input type="radio" name="fmt" checked="{{ ev.isMatch }}" onChange="{{ setFmtMatch }}">Match play</label>
                <label class="seg-opt"><input type="radio" name="fmt" checked="{{ ev.isStroke }}" onChange="{{ setFmtStroke }}">Stroke play</label>
              </div>
            </div>
          </div>
          <div class="field"><label>Golf course</label><input class="input" value="{{ ev.course }}" onChange="{{ setEvCourse }}"></div>
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px">
            <div class="field"><label>City</label><input class="input" value="{{ ev.city }}" onChange="{{ setEvCity }}"></div>
            <div class="field"><label>Address</label><input class="input" value="{{ ev.address }}" onChange="{{ setEvAddr }}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label>Registration deadline</label><input class="input" value="{{ ev.regDeadline }}" onChange="{{ setRegDeadline }}"></div>
            <div class="field"><label>Field capacity</label><input class="input" type="number" value="{{ ev.capacity }}" onChange="{{ setCapacity }}"></div>
          </div>
          <div class="field">
            <label>Player count</label>
            <div class="seg"><label class="seg-opt"><input type="radio" name="pcmode" checked="{{ ev.isCountReg }}" onChange="{{ setCountModeReg }}">From registrations</label><label class="seg-opt"><input type="radio" name="pcmode" checked="{{ ev.isCountManual }}" onChange="{{ setCountModeManual }}">Manual</label></div>
          </div>
          <sc-if value="{{ ev.isCountManual }}" hint-placeholder-val="{{ false }}">
            <div style="display:flex;gap:8px;align-items:flex-end">
              <div class="field" style="flex:1"><label>Target player count</label><input class="input" type="number" value="{{ ev.manualPlayerCount }}" onChange="{{ setManualCount }}"></div>
              <button type="button" class="btn btn-secondary" onClick="{{ applyManualCount }}">Apply</button>
            </div>
            <p class="text-muted" style="font-size:12px;margin:-6px 0 0">Pads with waitlist/placeholder entries or trims the roster to this exact count, then regroups.</p>
          </sc-if>
          <sc-if value="{{ ev.isCountReg }}" hint-placeholder-val="{{ true }}">
            <p class="text-muted" style="font-size:12px;margin:-6px 0 0">Player count tracks confirmed registrations live — currently {{ playersCount }}.</p>
          </sc-if>
          <div style="display:flex;gap:8px"><button type="button" class="btn btn-primary"><i class="ph ph-check"></i> Save event</button><button type="button" class="btn btn-secondary">Cancel</button></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="card elev-sm"><span class="card-kicker">Pilot summary</span>
            <sc-for list="{{ eventSummary }}" as="s" hint-placeholder-count="4">
              <div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid var(--color-divider)"><span class="text-muted">{{ s.k }}</span><span style="font-weight:500">{{ s.v }}</span></div>
            </sc-for>
          </div>
          <div class="card elev-sm"><span class="card-title" style="font-size:15px">Recommended flow</span><p class="card-body">Roster → Grouping → Stage builder → Scoring rules → run stages → Qualification → Brackets → Reports.</p></div>
        </div>
      </div>
    </sc-if>

    <!-- REGISTRATION -->
    <sc-if value="{{ show.registration }}" hint-placeholder-val="{{ false }}">
      <div style="margin-bottom:20px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Setup</div><h2 style="font-size:27px;margin:5px 0 0">Registration</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Open sign-up for this pilot. Field size isn't fixed — confirm players as they register, up to capacity.</p></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div class="card elev-sm" style="gap:2px"><span class="card-kicker">Confirmed</span><div style="font-family:var(--font-heading);font-size:24px">{{ playersCount }}</div><div class="text-muted" style="font-size:12px">of {{ ev.capacity }} capacity</div></div>
        <div class="card elev-sm" style="gap:2px"><span class="card-kicker">Waitlisted</span><div style="font-family:var(--font-heading);font-size:24px">{{ waitlistCount }}</div><div class="text-muted" style="font-size:12px">bumped in if a spot opens</div></div>
        <div class="card elev-sm" style="gap:2px"><span class="card-kicker">Registration closes</span><div style="font-family:var(--font-heading);font-size:18px">{{ ev.regDeadline }}</div><div class="text-muted" style="font-size:12px">groups lock after this date</div></div>
        <div class="card elev-sm" style="gap:2px"><span class="card-kicker">Status</span><div style="font-family:var(--font-heading);font-size:18px;color:var(--color-accent-200)">{{ regStatusText }}</div><div class="text-muted" style="font-size:12px">spots remaining: {{ spotsLeft }}</div></div>
      </div>
      <div class="card elev-sm" style="margin-bottom:16px;gap:12px">
        <span class="card-title" style="font-size:15px">Invite players to sign up</span>
        <p class="text-muted" style="font-size:12px;margin:-4px 0 0">Broadcast the sign-up link to your player group (e.g. a WhatsApp group) or copy it into any channel.</p>
        <div class="field"><label>Message</label><textarea class="input" rows="3" value="{{ inviteMessage }}" onChange="{{ setInviteMessage }}" style="resize:vertical;font-family:inherit"></textarea></div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-primary" onClick="{{ sendWhatsApp }}"><i class="ph-fill ph-whatsapp-logo"></i> Send via WhatsApp</button>
          <button type="button" class="btn btn-secondary" onClick="{{ copyInvite }}"><i class="ph ph-copy"></i> Copy message</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start">
        <div class="card elev-sm" style="gap:12px">
          <span class="card-title" style="font-size:15px">Add a signup</span>
          <div class="field"><label>Player name</label><input class="input" value="{{ signupForm.name }}" onChange="{{ setSignupName }}" placeholder="Full name"></div>
          <div class="field"><label>Handicap</label><input class="input" type="number" value="{{ signupForm.handicap }}" onChange="{{ setSignupHandicap }}"></div>
          <button type="button" class="btn btn-primary btn-block" onClick="{{ addSignup }}"><i class="ph ph-plus"></i> Add to field</button>
          <p class="text-muted" style="font-size:12px;margin:0">Auto-confirms while under capacity; overflow goes to the waitlist.</p>
          <div style="border-top:1px solid var(--color-divider);padding-top:10px">
            <label class="btn btn-secondary btn-block" style="cursor:pointer;justify-content:center"><i class="ph ph-upload-simple"></i> Import CSV<input type="file" accept=".csv,text/csv" onChange="{{ importCsv }}" style="display:none"></label>
            <p class="text-muted" style="font-size:12px;margin:6px 0 0">Columns: name, handicap</p>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card elev-sm">
            <span class="card-title" style="font-size:15px">Confirmed field ({{ playersCount }})</span>
            <table class="table" style="font-size:13px">
              <thead><tr><th style="width:36px">#</th><th>Player</th><th style="text-align:right">Handicap</th><th style="width:60px"></th></tr></thead>
              <tbody>
                <sc-for list="{{ signupRowsConfirmed }}" as="p" hint-placeholder-count="10">
                  <tr><td class="text-muted">{{ p.seed }}</td><td style="font-weight:500">{{ p.name }}</td><td style="text-align:right;font-variant-numeric:tabular-nums">{{ p.handicap }}</td><td style="text-align:right"><button type="button" class="btn btn-icon" onClick="{{ p.remove }}"><i class="ph ph-x"></i></button></td></tr>
                </sc-for>
              </tbody>
            </table>
          </div>
          <div class="card elev-sm">
            <span class="card-title" style="font-size:15px">Waitlist ({{ waitlistCount }})</span>
            <table class="table" style="font-size:13px">
              <thead><tr><th style="width:36px">#</th><th>Player</th><th style="text-align:right">Handicap</th><th style="width:60px"></th></tr></thead>
              <tbody>
                <sc-for list="{{ signupRowsWaitlist }}" as="p" hint-placeholder-count="3">
                  <tr><td class="text-muted">{{ p.seed }}</td><td style="font-weight:500">{{ p.name }}</td><td style="text-align:right;font-variant-numeric:tabular-nums">{{ p.handicap }}</td><td style="text-align:right"><button type="button" class="btn btn-icon" onClick="{{ p.remove }}"><i class="ph ph-x"></i></button></td></tr>
                </sc-for>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </sc-if>

    <!-- ACCESS CONTROL -->
    <sc-if value="{{ show.access }}" hint-placeholder-val="{{ false }}">
      <div style="margin-bottom:20px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Setup</div><h2 style="font-size:27px;margin:5px 0 0">Access control</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Organizers get full admin access. Players get read-only leaderboard/stats plus score entry for their own matches.</p></div>
      <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start">
        <div class="card elev-sm">
          <span class="card-title" style="font-size:15px">Accounts</span>
          <table class="table">
            <thead><tr><th>Name</th><th>Email</th><th style="width:200px">Role</th><th style="width:60px"></th></tr></thead>
            <tbody>
              <sc-for list="{{ accountRows }}" as="a" hint-placeholder-count="6">
                <tr>
                  <td style="font-weight:500">{{ a.name }}</td>
                  <td class="text-muted">{{ a.email }}</td>
                  <td>
                    <div class="seg"><label class="seg-opt"><input type="radio" name="{{ a.radioName }}" checked="{{ a.isAdmin }}" onChange="{{ a.makeAdmin }}">Organizer</label><label class="seg-opt"><input type="radio" name="{{ a.radioName }}" checked="{{ a.isPlayer }}" onChange="{{ a.makePlayer }}">Player</label></div>
                  </td>
                  <td style="text-align:right"><button type="button" class="btn btn-icon" onClick="{{ a.remove }}"><i class="ph ph-x"></i></button></td>
                </tr>
              </sc-for>
            </tbody>
          </table>
        </div>
        <div class="card elev-sm" style="gap:12px">
          <span class="card-title" style="font-size:15px">Add account</span>
          <div class="field"><label>Name</label><input class="input" value="{{ accountForm.name }}" onChange="{{ setAccName }}"></div>
          <div class="field"><label>Email</label><input class="input" value="{{ accountForm.email }}" onChange="{{ setAccEmail }}"></div>
          <div class="field"><label>Role</label><div class="seg"><label class="seg-opt"><input type="radio" name="newrole" checked="{{ accountForm.isAdmin }}" onChange="{{ setAccAdmin }}">Organizer</label><label class="seg-opt"><input type="radio" name="newrole" checked="{{ accountForm.isPlayer }}" onChange="{{ setAccPlayer }}">Player</label></div></div>
          <button type="button" class="btn btn-primary btn-block" onClick="{{ addAccount }}"><i class="ph ph-plus"></i> Add account</button>
        </div>
      </div>
    </sc-if>

    <!-- ROSTER -->
    <sc-if value="{{ show.roster }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px"><div><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Setup</div><h2 style="font-size:27px;margin:5px 0 0">Player roster</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">{{ playersCount }} players · seeded by ranking. Handicaps drive grouping.</p></div><div style="display:flex;gap:8px"><label class="btn btn-secondary" style="cursor:pointer"><i class="ph ph-upload-simple"></i> Import CSV<input type="file" accept=".csv,text/csv" onChange="{{ importCsv }}" style="display:none"></label><button type="button" class="btn btn-primary" onClick="{{ goRegistration }}"><i class="ph ph-plus"></i> Add player</button></div></div>
      <div class="card elev-sm">
        <table class="table">
          <thead><tr><th style="width:44px">Seed</th><th>Player</th><th style="text-align:right">Handicap</th><th>Group</th><th>Record</th><th style="text-align:right">Pts</th><th style="width:60px"></th></tr></thead>
          <tbody>
            <sc-for list="{{ rosterRows }}" as="p" hint-placeholder-count="12">
              <tr>
                <td style="font-variant-numeric:tabular-nums;color:var(--color-neutral-400)">{{ p.seed }}</td>
                <td style="font-weight:500">{{ p.name }}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums">{{ p.handicap }}</td>
                <td><span class="tag tag-neutral">{{ p.group }}</span></td>
                <td class="text-muted" style="font-variant-numeric:tabular-nums">{{ p.record }}</td>
                <td style="text-align:right;font-weight:600;color:var(--color-accent-200);font-variant-numeric:tabular-nums">{{ p.ptsText }}</td>
                <td style="text-align:right"><button type="button" class="btn btn-icon"><i class="ph ph-dots-three"></i></button></td>
              </tr>
            </sc-for>
          </tbody>
        </table>
      </div>
    </sc-if>

    <!-- GROUPING -->
    <sc-if value="{{ show.grouping }}" hint-placeholder-val="{{ false }}">
      <div style="margin-bottom:20px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Setup</div><h2 style="font-size:27px;margin:5px 0 0">Grouping rules</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Auto-form groups by a rule, then override manually per player.</p></div>
      <div class="card elev-sm" style="margin-bottom:16px">
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between">
          <div>
            <div class="text-muted" style="font-size:12px;margin-bottom:6px">Formation rule</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <sc-for list="{{ ruleOptions }}" as="ro" hint-placeholder-count="4">
                <button type="button" onClick="{{ ro.pick }}" style="{{ ro.style }}"><i class="{{ ro.icon }}"></i> {{ ro.label }}</button>
              </sc-for>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="text-muted" style="font-size:12px">8 groups · 4 players each</span>
            <button type="button" class="btn btn-primary" onClick="{{ regenGroups }}"><i class="ph ph-shuffle"></i> Generate groups</button>
          </div>
        </div>
        <p class="text-muted" style="font-size:12px;margin:12px 0 0">{{ ruleDesc }}</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
        <sc-for list="{{ groupsFull }}" as="g" hint-placeholder-count="8">
          <div class="card elev-sm" style="gap:6px">
            <div style="display:flex;align-items:center;justify-content:space-between"><span style="font-weight:600;font-size:14px">{{ g.name }}</span><span class="text-muted" style="font-size:11px">avg hcp {{ g.avgHcp }}</span></div>
            <sc-for list="{{ g.players }}" as="pl" hint-placeholder-count="4">
              <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--color-divider)"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ pl.name }}</span><span class="text-muted" style="font-variant-numeric:tabular-nums">{{ pl.tag }}</span></div>
            </sc-for>
          </div>
        </sc-for>
      </div>
    </sc-if>

    <!-- STAGE BUILDER -->
    <sc-if value="{{ show.stages }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px"><div><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Setup</div><h2 style="font-size:27px;margin:5px 0 0">Stage builder</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Sequence the tournament. Each stage feeds the next.</p></div><button type="button" class="btn btn-secondary"><i class="ph ph-plus"></i> Add stage</button></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <sc-for list="{{ stagesView }}" as="st" hint-placeholder-count="4">
          <div class="card elev-sm" style="flex-direction:row;align-items:center;gap:16px;{{ st.wrapExtra }}">
            <div style="width:44px;height:44px;flex:none;border-radius:10px;display:grid;place-items:center;background:{{ st.badgeBg }};color:{{ st.badgeColor }}"><i class="{{ st.icon }}" style="font-size:22px"></i></div>
            <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px"><span style="font-family:var(--font-heading);font-weight:500;font-size:16px">Stage {{ st.n }} · {{ st.type }}</span><span class="tag {{ st.tagClass }}">{{ st.status }}</span></div><div class="text-muted" style="font-size:13px;margin-top:2px">{{ st.desc }}</div></div>
            <div class="field" style="width:200px"><label>Completion deadline</label><input class="input" value="{{ st.deadline }}" onChange="{{ st.setDeadline }}"></div>
            <div style="display:flex;gap:6px"><button type="button" class="btn btn-icon"><i class="ph ph-gear-six"></i></button><button type="button" class="btn btn-icon"><i class="ph ph-arrows-out-line-vertical"></i></button></div>
          </div>
          <sc-if value="{{ st.showCarry }}" hint-placeholder-val="{{ false }}">
            <div style="{{ st.wrapExtra }};margin-top:-4px;padding:12px 16px;border:1px solid var(--color-divider);border-radius:var(--radius-md);display:flex;align-items:center;gap:16px;background:var(--color-bg)">
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;white-space:nowrap"><input type="checkbox" checked="{{ st.carryEnabled }}" onChange="{{ st.toggleCarry }}"> Carry forward points from previous stage</label>
              <input type="range" min="0" max="100" step="5" value="{{ st.carryPct }}" onChange="{{ st.setCarryPct }}" disabled="{{ st.carryDisabledAttr }}" style="flex:1">
              <span class="tag tag-accent" style="min-width:48px;text-align:center">{{ st.carryPctText }}</span>
            </div>
            <p class="text-muted" style="font-size:12px;margin:0 0 0 2px">{{ st.carryExample }}</p>
          </sc-if>
        </sc-for>
      </div>
    </sc-if>

    <!-- ROUND ROBIN SETUP -->
    <sc-if value="{{ show.rr }}" hint-placeholder-val="{{ false }}">
      <div style="margin-bottom:20px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Setup · Stage 1</div><h2 style="font-size:27px;margin:5px 0 0">Round robin setup</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Every player meets every other in their group. Schedule auto-generated.</p></div>
      <div style="display:grid;grid-template-columns:280px 1fr;gap:16px;align-items:start">
        <div class="card elev-sm" style="gap:12px">
          <span class="card-title" style="font-size:15px">Configuration</span>
          <div class="field"><label>Rounds per group</label><input class="input" value="3" readonly></div>
          <div class="field"><label>Match length</label><input class="input" value="18 holes · match play" readonly></div>
          <div class="field"><label>Meetings</label><input class="input" value="Single round robin" readonly></div>
          <div style="display:flex;justify-content:space-between;font-size:13px;padding-top:8px;border-top:1px solid var(--color-divider)"><span class="text-muted">Total matches</span><span style="font-weight:600">{{ rrTotal }}</span></div>
        </div>
        <div class="card elev-sm">
          <div style="display:flex;align-items:center;justify-content:space-between"><span class="card-title">Schedule preview — {{ rrGroupName }}</span>
            <select class="input" style="width:auto" onChange="{{ setRrGroup }}"><sc-for list="{{ groupSelect }}" as="o" hint-placeholder-count="8"><option value="{{ o.id }}" selected="{{ o.selected }}">{{ o.name }}</option></sc-for></select>
          </div>
          <sc-for list="{{ rrRounds }}" as="rd" hint-placeholder-count="3">
            <div style="margin-top:10px"><div style="font-size:12px;font-weight:600;color:var(--color-neutral-400);margin-bottom:4px">Round {{ rd.n }}</div>
              <sc-for list="{{ rd.matches }}" as="m" hint-placeholder-count="2">
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;padding:7px 10px;background:var(--color-bg);border-radius:6px;margin-bottom:5px"><span style="flex:1">{{ m.a }}</span><span class="text-muted" style="font-size:11px;padding:0 10px">vs</span><span style="flex:1;text-align:right">{{ m.b }}</span><span class="tag {{ m.tagClass }}" style="margin-left:10px">{{ m.status }}</span></div>
              </sc-for>
            </div>
          </sc-for>
        </div>
      </div>
    </sc-if>

    <!-- SCORING RULES -->
    <sc-if value="{{ show.scoring }}" hint-placeholder-val="{{ false }}">
      <div style="margin-bottom:20px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Setup</div><h2 style="font-size:27px;margin:5px 0 0">Scoring rules</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Points awarded in round-robin stages. Standings recalculate instantly.</p></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
        <div class="card elev-sm" style="gap:14px">
          <span class="card-title" style="font-size:15px">Points</span>
          <sc-for list="{{ scoringFields }}" as="f" hint-placeholder-count="5">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div><div style="font-size:14px;font-weight:500">{{ f.label }}</div><div class="text-muted" style="font-size:12px">{{ f.hint }}</div></div><input class="input" type="number" step="{{ f.step }}" style="width:90px;text-align:right" value="{{ f.value }}" onChange="{{ f.onChange }}"></div>
          </sc-for>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card elev-sm">
            <span class="card-title" style="font-size:15px">Tiebreakers</span>
            <p class="text-muted" style="font-size:12px;margin:-2px 0 4px">Applied in order when points are level.</p>
            <sc-for list="{{ tiebreakers }}" as="t" hint-placeholder-count="4">
              <div style="display:flex;align-items:center;gap:10px;font-size:13px;padding:7px 10px;background:var(--color-bg);border-radius:6px;margin-bottom:5px"><span style="width:20px;height:20px;border-radius:50%;background:var(--color-accent-800);color:var(--color-accent-100);display:grid;place-items:center;font-size:11px">{{ t.n }}</span><span style="flex:1">{{ t.label }}</span><i class="ph ph-dots-six-vertical text-muted"></i></div>
            </sc-for>
          </div>
          <div class="card elev-sm"><span class="card-kicker">Worked example</span><p class="card-body" style="font-size:13px">{{ scoringExample }}</p></div>
        </div>
      </div>
    </sc-if>

    <!-- QUALIFICATION -->
    <sc-if value="{{ show.qual }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px"><div><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Stage 3</div><h2 style="font-size:27px;margin:5px 0 0">Qualification</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Set the cutoff. Advancing players feed the brackets.</p></div>
        <div style="display:flex;gap:8px;align-items:center"><span class="text-muted" style="font-size:12px">Advance per group</span><div class="seg"><sc-for list="{{ qualOptions }}" as="q" hint-placeholder-count="3"><label class="seg-opt"><input type="radio" name="qpg" checked="{{ q.checked }}" onChange="{{ q.pick }}">Top {{ q.n }}</label></sc-for></div></div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px"><div class="card elev-sm" style="flex:1;gap:2px"><span class="card-kicker">Advancing</span><div style="font-family:var(--font-heading);font-size:24px">{{ qualCount }} / {{ playersCount }}</div></div><div class="card elev-sm" style="flex:1;gap:2px"><span class="card-kicker">To Winners bracket</span><div style="font-family:var(--font-heading);font-size:24px">8</div></div><div class="card elev-sm" style="flex:1;gap:2px"><span class="card-kicker">To Consolation</span><div style="font-family:var(--font-heading);font-size:24px">8</div></div><div class="card elev-sm" style="flex:1;gap:2px"><span class="card-kicker">Cutoff pts</span><div style="font-family:var(--font-heading);font-size:24px">{{ cutoffText }}</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px">
        <sc-for list="{{ groupsView }}" as="g" hint-placeholder-count="8">
          <div class="card elev-sm">
            <span style="font-weight:600;font-size:14px">{{ g.name }}</span>
            <table class="table" style="font-size:13px">
              <tbody>
                <sc-for list="{{ g.rows }}" as="r" hint-placeholder-count="4">
                  <tr style="{{ r.qualRowStyle }}"><td style="width:26px;color:var(--color-neutral-500)">{{ r.rank }}</td><td style="font-weight:500">{{ r.short }}</td><td><span class="{{ r.qualTagClass }}">{{ r.qualTag }}</span></td><td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">{{ r.ptsText }}</td></tr>
                </sc-for>
              </tbody>
            </table>
          </div>
        </sc-for>
      </div>
    </sc-if>

    <!-- BRACKET MANAGER -->
    <sc-if value="{{ show.bracket }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px"><div><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Stage 4</div><h2 style="font-size:27px;margin:5px 0 0">Bracket manager</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Seeded from qualification. Click a name to advance the winner.</p></div>
        <div class="seg"><sc-for list="{{ bracketTabs }}" as="bt" hint-placeholder-count="2"><label class="seg-opt"><input type="radio" name="brk" checked="{{ bt.checked }}" onChange="{{ bt.pick }}">{{ bt.label }}</label></sc-for></div>
      </div>
      <div class="card elev-sm" style="overflow-x:auto">
        <div style="display:flex;gap:26px;min-width:640px">
          <sc-for list="{{ bracketView }}" as="rd" hint-placeholder-count="3">
            <div style="flex:1;display:flex;flex-direction:column;justify-content:space-around;gap:14px;min-width:180px">
              <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-neutral-500);text-align:center">{{ rd.label }}</div>
              <sc-for list="{{ rd.matches }}" as="m" hint-placeholder-count="4">
                <div style="border:1px solid var(--color-divider);border-radius:8px;overflow:hidden">
                  <button type="button" onClick="{{ m.onA }}" style="{{ m.aStyle }}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.aName }}</span><span style="font-size:11px;color:var(--color-neutral-500)">{{ m.aSeed }}</span></button>
                  <div style="height:1px;background:var(--color-divider)"></div>
                  <button type="button" onClick="{{ m.onB }}" style="{{ m.bStyle }}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.bName }}</span><span style="font-size:11px;color:var(--color-neutral-500)">{{ m.bSeed }}</span></button>
                </div>
              </sc-for>
            </div>
          </sc-for>
          <div style="flex:none;width:150px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;text-align:center">
            <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-neutral-500)">Champion</div>
            <i class="ph-fill ph-trophy" style="font-size:30px;color:var(--color-accent)"></i>
            <div style="font-family:var(--font-heading);font-weight:500;font-size:15px">{{ champName }}</div>
          </div>
        </div>
      </div>
    </sc-if>

    <!-- SCORECARD GENERATOR -->
    <sc-if value="{{ show.scorecard }}" hint-placeholder-val="{{ false }}">
      <div style="margin-bottom:20px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Scoring</div><h2 style="font-size:27px;margin:5px 0 0">Scorecard generator</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Build a match-play scorecard for a course, then send it to score entry.</p></div>
      <div style="display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start">
        <div class="card elev-sm" style="gap:14px">
          <div class="field"><label>Course</label><select class="input" onChange="{{ applyPreset }}"><sc-for list="{{ courseOptions }}" as="c" hint-placeholder-count="4"><option value="{{ c.name }}" selected="{{ c.selected }}">{{ c.name }}</option></sc-for></select></div>
          <div class="field"><label>City</label><input class="input" value="{{ scForm.city }}" onChange="{{ setScCity }}"></div>
          <div class="field"><label>Address <span class="text-muted">· auto-populated</span></label><input class="input" value="{{ scForm.address }}" onChange="{{ setScAddr }}"></div>
          <div class="field"><label>Match length</label><div class="seg"><label class="seg-opt"><input type="radio" name="hlen" checked="{{ scForm.is18 }}" onChange="{{ set18 }}">18 holes</label><label class="seg-opt"><input type="radio" name="hlen" checked="{{ scForm.is9 }}" onChange="{{ set9 }}">9 holes</label></div></div>
          <div class="field"><label>Nine</label><div class="seg"><label class="seg-opt"><input type="radio" name="nine" checked="{{ scForm.isFront }}" onChange="{{ setFront }}">Front nine</label><label class="seg-opt"><input type="radio" name="nine" checked="{{ scForm.isBack }}" onChange="{{ setBack }}">Back nine</label></div></div>
          <button type="button" class="btn btn-primary btn-block" onClick="{{ goEntry }}"><i class="ph ph-cards"></i> Generate & open score entry</button>
        </div>
        <div class="card elev-sm">
          <div style="display:flex;align-items:flex-start;justify-content:space-between"><div><div style="font-family:var(--font-heading);font-weight:500;font-size:17px">{{ scForm.course }}</div><div class="text-muted" style="font-size:12px">{{ scForm.address }}</div></div><span class="tag tag-outline">{{ scForm.lenLabel }}</span></div>
          <div style="overflow-x:auto;margin-top:12px">
            <table class="table" style="font-size:12px;min-width:520px">
              <thead><tr><th>Hole</th><sc-for list="{{ scPreview }}" as="h" hint-placeholder-count="9"><th style="text-align:center">{{ h.num }}</th></sc-for><th style="text-align:center">Tot</th></tr></thead>
              <tbody>
                <tr><td class="text-muted">Par</td><sc-for list="{{ scPreview }}" as="h" hint-placeholder-count="9"><td style="text-align:center;font-variant-numeric:tabular-nums">{{ h.par }}</td></sc-for><td style="text-align:center;font-weight:600">{{ scPar }}</td></tr>
                <tr><td class="text-muted">Yards</td><sc-for list="{{ scPreview }}" as="h" hint-placeholder-count="9"><td style="text-align:center;font-variant-numeric:tabular-nums;color:var(--color-neutral-400)">{{ h.yards }}</td></sc-for><td style="text-align:center;color:var(--color-neutral-400)">{{ scYards }}</td></tr>
                <tr><td style="font-weight:500">Result</td><sc-for list="{{ scPreview }}" as="h" hint-placeholder-count="9"><td style="text-align:center;color:var(--color-neutral-600)">·</td></sc-for><td></td></tr>
              </tbody>
            </table>
          </div>
          <p class="text-muted" style="font-size:12px;margin-top:8px">Match-play scorecard — each hole is scored win / halve / loss during entry.</p>
        </div>
      </div>
    </sc-if>

    <!-- SCORE ENTRY -->
    <sc-if value="{{ show.entry }}" hint-placeholder-val="{{ false }}">
      <div style="margin-bottom:20px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Scoring</div><h2 style="font-size:27px;margin:5px 0 0">Score entry</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Tap each hole: home wins, halved, or away wins. Standings update live.</p></div>
      <div style="display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start">
        <div class="card elev-sm" style="gap:6px;max-height:74vh;overflow:auto">
          <span class="card-kicker">Stage 1 matches</span>
          <sc-for list="{{ matchPicker }}" as="m" hint-placeholder-count="10">
            <button type="button" onClick="{{ m.open }}" style="{{ m.style }}"><span style="flex:1;min-width:0"><span style="display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.title }}</span><span style="font-size:11px;color:var(--color-neutral-500)">{{ m.sub }}</span></span><span class="tag {{ m.tagClass }}">{{ m.status }}</span></button>
          </sc-for>
        </div>
        <div class="card elev-sm">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div><div class="text-muted" style="font-size:12px">{{ activeMatch.groupName }} · Round {{ activeMatch.round }}</div><div style="font-family:var(--font-heading);font-size:18px;margin-top:2px">{{ activeMatch.aName }} <span class="text-muted" style="font-size:13px">vs</span> {{ activeMatch.bName }}</div></div>
            <div style="text-align:right"><div style="font-family:var(--font-heading);font-size:22px;color:var(--color-accent-200)">{{ activeMatch.statusBig }}</div><div class="text-muted" style="font-size:12px">{{ activeMatch.statusSub }}</div></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0">
            <div class="seg"><label class="seg-opt"><input type="radio" name="entrymode" checked="{{ entryModeHoles }}" onChange="{{ setModeHoles }}">Hole-by-hole</label><label class="seg-opt"><input type="radio" name="entrymode" checked="{{ entryModeResult }}" onChange="{{ setModeResult }}">Match result</label></div>
          </div>
          <sc-if value="{{ entryModeHoles }}" hint-placeholder-val="{{ true }}">
          <div style="display:flex;gap:12px;margin:12px 0;font-size:13px"><span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-accent)"></span>{{ activeMatch.aName }}</span><span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-neutral-600)"></span>Halved</span><span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:var(--color-accent-2-500)"></span>{{ activeMatch.bName }}</span></div>
          <div style="display:grid;grid-template-columns:repeat(9,1fr);gap:6px">
            <sc-for list="{{ activeMatch.holes }}" as="h" hint-placeholder-count="18">
              <div style="border:1px solid var(--color-divider);border-radius:6px;overflow:hidden;text-align:center">
                <div style="font-size:10px;padding:2px 0;color:var(--color-neutral-500);background:var(--color-bg)">{{ h.label }}</div>
                <div style="display:flex;flex-direction:column">
                  <button type="button" onClick="{{ h.setA }}" style="{{ h.aStyle }}">A</button>
                  <button type="button" onClick="{{ h.setH }}" style="{{ h.hStyle }}">½</button>
                  <button type="button" onClick="{{ h.setB }}" style="{{ h.bStyle }}">B</button>
                </div>
              </div>
            </sc-for>
          </div>
          </sc-if>
          <sc-if value="{{ entryModeResult }}" hint-placeholder-val="{{ false }}">
          <div class="card elev-sm" style="margin:12px 0;gap:12px;background:var(--color-bg)">
            <div>
              <div class="text-muted" style="font-size:12px;margin-bottom:6px">Winner</div>
              <div class="seg">
                <label class="seg-opt"><input type="radio" name="rwin" checked="{{ resultForm.isA }}" onChange="{{ setResultA }}">{{ activeMatch.aName }}</label>
                <label class="seg-opt"><input type="radio" name="rwin" checked="{{ resultForm.isH }}" onChange="{{ setResultH }}">Halved</label>
                <label class="seg-opt"><input type="radio" name="rwin" checked="{{ resultForm.isB }}" onChange="{{ setResultB }}">{{ activeMatch.bName }}</label>
              </div>
            </div>
            <div class="field"><label>Result (e.g. "3&2", "1 UP", "AS")</label>
              <div style="display:flex;gap:8px">
                <input class="input" value="{{ resultForm.margin }}" onChange="{{ setResultMargin }}" placeholder="3&2">
                <button type="button" class="btn btn-icon" onClick="{{ toggleListen }}" title="Dictate result" style="{{ micStyle }}"><i class="{{ micIcon }}"></i></button>
              </div>
              <div class="text-muted" style="font-size:12px">{{ listenHint }}</div>
            </div>
            <button type="button" class="btn btn-primary btn-block" onClick="{{ applyResult }}"><i class="ph ph-check"></i> Apply result</button>
          </div>
          </sc-if>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid var(--color-divider)"><span class="text-muted" style="font-size:12px">{{ activeMatch.holesWonText }}</span><div style="display:flex;gap:8px"><button type="button" class="btn btn-secondary" onClick="{{ clearMatch }}">Clear</button><button type="button" class="btn btn-primary" onClick="{{ goLeaderboard }}"><i class="ph ph-check"></i> Save & view standings</button></div></div>
        </div>
      </div>
    </sc-if>

    <!-- LEADERBOARD -->
    <sc-if value="{{ show.leaderboard }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px"><div><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Live</div><h2 style="font-size:27px;margin:5px 0 0">Live leaderboard</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Overall standings across all groups · points breakdown.</p></div><span class="tag tag-accent"><i class="ph-fill ph-circle" style="font-size:8px;margin-right:5px"></i> Updating live</span></div>
      <div class="card elev-sm">
        <table class="table">
          <thead><tr><th style="width:40px">#</th><th>Player</th><th>Group</th><th style="text-align:center">P</th><th style="text-align:center">W</th><th style="text-align:center">H</th><th style="text-align:center">L</th><th style="text-align:right">Holes ±</th><th style="text-align:right">Points</th></tr></thead>
          <tbody>
            <sc-for list="{{ leaderFull }}" as="r" hint-placeholder-count="16">
              <tr style="{{ r.rowStyle }}">
                <td><span style="{{ r.badge }}">{{ r.rank }}</span></td>
                <td style="font-weight:500">{{ r.name }}</td>
                <td class="text-muted">{{ r.group }}</td>
                <td style="text-align:center;font-variant-numeric:tabular-nums">{{ r.played }}</td>
                <td style="text-align:center;font-variant-numeric:tabular-nums">{{ r.w }}</td>
                <td style="text-align:center;font-variant-numeric:tabular-nums">{{ r.t }}</td>
                <td style="text-align:center;font-variant-numeric:tabular-nums">{{ r.l }}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums">{{ r.diffText }}</td>
                <td style="text-align:right;font-weight:600;color:var(--color-accent-200);font-variant-numeric:tabular-nums">{{ r.ptsText }}</td>
              </tr>
            </sc-for>
          </tbody>
        </table>
      </div>
    </sc-if>

    <!-- REPORTS -->
    <sc-if value="{{ show.reports }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px"><div><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent)">Output</div><h2 style="font-size:27px;margin:5px 0 0">Reports & export</h2><p class="text-muted" style="margin:6px 0 0;font-size:13px">Snapshot the event and export results for distribution.</p></div><div style="display:flex;gap:8px"><button type="button" class="btn btn-secondary" onClick="{{ printPage }}"><i class="ph ph-printer"></i> Print</button><button type="button" class="btn btn-primary" onClick="{{ exportCSV }}"><i class="ph ph-download-simple"></i> Export CSV</button></div></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <sc-for list="{{ reportStats }}" as="c" hint-placeholder-count="4">
          <div class="card elev-sm" style="gap:2px"><span class="card-kicker">{{ c.label }}</span><div style="font-family:var(--font-heading);font-size:24px">{{ c.value }}</div><div class="text-muted" style="font-size:12px">{{ c.sub }}</div></div>
        </sc-for>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
        <div class="card elev-sm">
          <span class="card-title" style="font-size:15px">Available exports</span>
          <sc-for list="{{ exportList }}" as="e" hint-placeholder-count="5">
            <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--color-divider)"><i class="{{ e.icon }}" style="color:var(--color-accent);font-size:18px"></i><div style="flex:1"><div style="font-size:14px;font-weight:500">{{ e.name }}</div><div class="text-muted" style="font-size:12px">{{ e.desc }}</div></div><button type="button" class="btn btn-secondary" onClick="{{ exportCSV }}">Export</button></div>
          </sc-for>
        </div>
        <div class="card elev-sm">
          <span class="card-title" style="font-size:15px">Final standings snapshot</span>
          <table class="table" style="font-size:13px">
            <thead><tr><th style="width:34px">#</th><th>Player</th><th>Grp</th><th style="text-align:right">Pts</th><th>Status</th></tr></thead>
            <tbody>
              <sc-for list="{{ reportRows }}" as="r" hint-placeholder-count="10">
                <tr><td style="color:var(--color-neutral-500)">{{ r.rank }}</td><td style="font-weight:500">{{ r.name }}</td><td class="text-muted">{{ r.group }}</td><td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">{{ r.ptsText }}</td><td><span class="{{ r.tagClass }}">{{ r.statusTag }}</span></td></tr>
              </sc-for>
            </tbody>
          </table>
        </div>
      </div>
    </sc-if>

  </main>
</div>
</sc-if>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{&quot;$preview&quot;:{&quot;width&quot;:&quot;100%&quot;,&quot;height&quot;:800}}">
class Component extends DCLogic {
  constructor(props){ super(props); this.state = this.buildData(); }

  rng(seed){ let s = seed>>>0; return () => { s = (s*1664525 + 1013904223)>>>0; return s/4294967296; }; }

  buildData(){
    const names = ["Marcus Ellery","Priya Nair","Diego Salcedo","Hana Koval","Theo Brandt","Yuki Tanaka","Owen Marsh","Camille Roy","Sam Okafor","Nadia Petrov","Liam Cho","Ines Duarte","Rafael Costa","Greta Lindqvist","Amir Haddad","Noor Rahman","Ben Fletcher","Sofia Grinaldi","Jonas Vik","Maya Sørensen","Elias Frank","Tessa Wolfe","Kenji Mori","Ada Novak","Cole Whitman","Farah Aziz","Lucas Berg","Ravi Menon","Dana Kruger","Otto Lindberg","Ivy Castellano","Nate Sullivan","Zara Idris","Milo Fenwick"];
    const r = this.rng(7);
    const allSignups = names.map((n,i)=>{
      const base = 2 + i*0.58 + (r()-0.5)*5;
      return { id:'p'+i, name:n, handicap: Math.max(0, Math.round(base)) };
    });
    const capacity = 32;
    // Pilot demo: 30 confirmed signups (not a fixed field size), 3 on the waitlist.
    const confirmedCount = 30;
    const players = allSignups.slice(0, confirmedCount).map((p,i)=>({ ...p, seed:i+1 }));
    const waitlist = allSignups.slice(confirmedCount);
    const groups = this.formGroups(players, 'balanced');
    const stages = [
      { id:'s0', type:'Round Robin', desc:'Group play — every player meets every group-mate over 18-hole match play.', deadline:'May 14, 2026 · 6:00 PM' },
      { id:'s1', type:'Round Robin', desc:'Second round-robin cycle; points carry into combined standings.', deadline:'May 15, 2026 · 1:00 PM', carryForwardEnabled:true, carryForwardPct:50 },
      { id:'s2', type:'Qualification Match', desc:'Cutoff applied — top finishers per group advance to the bracket draw.', deadline:'May 15, 2026 · 6:00 PM', carryForwardEnabled:true, carryForwardPct:100 },
      { id:'s3', type:'Bracket Stage', desc:'Winners and Consolation brackets, single elimination.', deadline:'May 16, 2026 · 5:00 PM', carryForwardEnabled:false, carryForwardPct:0 },
    ];
    const scoring = { winPts:3, tiePts:1, lossPts:0, holeRatioPts:0.1, bonusPts:0 };
    const matches = this.seedMatches(this.buildMatches(groups, 's0'), players);
    const firstPending = matches.find(m=>!this.res(m).complete) || matches[0];
    const courses = this.courses();
    return {
      loggedIn:false, screen:'dashboard',
      event:{ name:'Nocturne Cup — Spring Pilot', dates:'May 14–16, 2026', course:'Ridgeline National', city:'Asheville, NC', address:'1200 Fairway Ridge Rd, Asheville, NC 28806', format:'match', capacity, regDeadline:'May 1, 2026 · 11:59 PM', playerCountMode:'registration', manualPlayerCount:confirmedCount },
      inviteMessage:`You're invited to the Nocturne Cup — Spring Pilot, May 14–16 at Ridgeline National, Asheville NC. Reply here to reserve your spot — 30 of 32 slots filled!`,
      players, waitlist, nextSignupId: allSignups.length, groupRule:'balanced', groups, stages, scoring, matches,
      qualifyPerGroup:2, bracketWinners:{}, bracketTab:'W', rrGroupId:'g0',
      activeMatchId: firstPending.id,
      entryMode:'holes', resultForm:{ winner:'A', margin:'' }, listening:false, listenError:null,
      role:'admin',
      accounts:[
        { id:'a0', name:'Alex Rourke', email:'alex@nocturnegolf.com', role:'admin' },
        { id:'a1', name:'Priya Nair', email:'priya.nair@example.com', role:'admin' },
        { id:'a2', name:'Marcus Ellery', email:'marcus.ellery@example.com', role:'player' },
        { id:'a3', name:'Hana Koval', email:'hana.koval@example.com', role:'player' },
      ],
      accountForm:{ name:'', email:'', role:'player' }, nextAccountId:4,
      scForm:{ course:courses[0].name, city:courses[0].city, address:courses[0].address, holes:18, nine:'front' },
      signupForm:{ name:'', handicap:12 },
    };
  }

  courses(){ return [
    { name:'Ridgeline National', city:'Asheville, NC', address:'1200 Fairway Ridge Rd, Asheville, NC 28806', pars:[4,4,3,5,4,4,3,4,5,4,5,3,4,4,3,5,4,4] },
    { name:'Harbor Dunes Links', city:'Charleston, SC', address:'88 Dune Grass Way, Charleston, SC 29412', pars:[4,3,5,4,4,4,3,5,4,4,4,3,4,5,4,3,4,5] },
    { name:'Cedar Hollow GC', city:'Boone, NC', address:'450 Cedar Hollow Rd, Boone, NC 28607', pars:[5,4,4,3,4,5,4,3,4,4,4,3,5,4,4,3,4,5] },
    { name:'Meadowbrook Country Club', city:'Greenville, SC', address:'7 Meadowbrook Dr, Greenville, SC 29607', pars:[4,4,4,3,5,4,4,3,5,4,3,4,5,4,4,3,4,5] },
  ]; }

  formGroups(players, rule){
    const alpha='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const groupCount = Math.max(2, Math.round(players.length/4)), names = alpha;
    let order;
    if (rule==='handicap') order = [...players].sort((a,b)=>a.handicap-b.handicap);
    else if (rule==='seeding') order = [...players].sort((a,b)=>a.seed-b.seed);
    else if (rule==='balanced') order = [...players].sort((a,b)=>a.handicap-b.handicap);
    else order = [...players].sort((a,b)=>a.seed-b.seed);
    const groups = Array.from({length:groupCount},(_,i)=>({ id:'g'+i, name:'Group '+names[i], playerIds:[] }));
    if (rule==='balanced' || rule==='seeding') {
      let g=0, dir=1;
      for (const p of order){ groups[g].playerIds.push(p.id); g+=dir; if(g>=groupCount){g=groupCount-1;dir=-1;} else if(g<0){g=0;dir=1;} }
    } else {
      order.forEach((p,i)=>groups[Math.floor(i/4)%groupCount].playerIds.push(p.id));
    }
    return groups;
  }

  schedule(ids){
    let a = [...ids]; if (a.length%2) a.push(null);
    const n=a.length, rounds=[];
    for (let r=0;r<n-1;r++){
      const pairs=[];
      for (let i=0;i<n/2;i++){ const x=a[i], y=a[n-1-i]; if(x!=null&&y!=null) pairs.push([x,y]); }
      rounds.push(pairs); a.splice(1,0,a.pop());
    }
    return rounds;
  }

  buildMatches(groups, stageId){
    const out=[]; let mid=0;
    groups.forEach(gr=>{
      this.schedule(gr.playerIds).forEach((pairs,ri)=>pairs.forEach(([a,b])=>{
        out.push({ id:'m'+(mid++), stageId, groupId:gr.id, round:ri+1, aId:a, bId:b, holes:Array(18).fill(null) });
      }));
    });
    return out;
  }

  seedMatches(matches, players){
    const rand = this.rng(20260514);
    const pmap = Object.fromEntries(players.map(p=>[p.id,p]));
    matches.forEach(m=>{
      const play = m.round===1 ? true : m.round===2 ? rand()<0.6 : false;
      if (!play) return;
      const A=pmap[m.aId], B=pmap[m.bId];
      let bias = 0.5 + (B.seed - A.seed)*0.012; bias = Math.max(0.28, Math.min(0.72, bias));
      const holes = Array(18).fill(null);
      const pHalf = 0.24, pA = (1-pHalf)*bias, pB = (1-pHalf)*(1-bias);
      for (let i=0;i<18;i++){ const x=rand(); holes[i] = x<pA ? 'A' : x<pA+pB ? 'B' : 'H'; }
      let a=0,b=0;
      for (let i=0;i<18;i++){ if(holes[i]==='A')a++; else if(holes[i]==='B')b++; const rem=17-i; if(Math.abs(a-b)>rem){ for(let j=i+1;j<18;j++)holes[j]=null; break; } }
      m.holes = holes;
    });
    return matches;
  }

  res(m){
    const holes=m.holes; let a=0,b=0,played=0;
    for (const h of holes){ if(h==null)continue; played++; if(h==='A')a++; else if(h==='B')b++; }
    const total=holes.length, remaining=total-played, lead=a-b;
    const decided = played>0 && Math.abs(lead)>remaining;
    const allPlayed = played===total && total>0;
    const complete = decided || allPlayed;
    let winnerId=null, resultText='—';
    if (complete){
      winnerId = lead>0 ? m.aId : lead<0 ? m.bId : null;
      if (lead===0) resultText='AS';
      else if (decided && remaining>0) resultText = `${Math.abs(lead)}&${remaining}`;
      else resultText = `${Math.abs(lead)} UP`;
    } else if (played>0){ resultText = lead===0 ? 'AS' : `${Math.abs(lead)} UP`; }
    return { a,b,played,total,remaining,lead,decided,allPlayed,complete,winnerId,resultText };
  }

  player(id){ return this.state.players.find(p=>p.id===id); }
  groupOf(id){ return this.state.groups.find(g=>g.playerIds.includes(id)); }

  groupStandings(gr){
    const { matches, scoring } = this.state;
    const rows = gr.playerIds.map(id=>{ const p=this.player(id); return { id, name:p.name, handicap:p.handicap, seed:p.seed, w:0,l:0,t:0,hw:0,hl:0,played:0,pts:0 }; });
    const map = Object.fromEntries(rows.map(r=>[r.id,r]));
    matches.filter(m=>m.groupId===gr.id).forEach(m=>{
      const r=this.res(m); if(!r.complete) return;
      const ra=map[m.aId], rb=map[m.bId]; if(!ra||!rb) return;
      ra.played++; rb.played++; ra.hw+=r.a; ra.hl+=r.b; rb.hw+=r.b; rb.hl+=r.a;
      if (r.winnerId===m.aId){ ra.w++; rb.l++; } else if (r.winnerId===m.bId){ rb.w++; ra.l++; } else { ra.t++; rb.t++; }
    });
    rows.forEach(r=>{ r.pts = r.w*scoring.winPts + r.l*scoring.lossPts + r.t*scoring.tiePts + r.hw*scoring.holeRatioPts + scoring.bonusPts; r.diff = r.hw-r.hl; });
    rows.sort((x,y)=> y.pts-x.pts || y.diff-x.diff || x.handicap-y.handicap);
    rows.forEach((r,i)=>r.rank=i+1);
    return rows;
  }

  allStandings(){
    const all=[];
    this.state.groups.forEach(gr=>{ const rows=this.groupStandings(gr); rows.forEach(r=>all.push({ ...r, group:gr.name, groupShort:gr.name.replace('Group ',''), groupRank:r.rank })); });
    all.sort((x,y)=> y.pts-x.pts || y.diff-x.diff || x.handicap-y.handicap);
    all.forEach((r,i)=>r.overall=i+1);
    return all;
  }

  qualifierSet(){
    const set=new Set();
    this.state.groups.forEach(gr=>{ this.groupStandings(gr).slice(0,this.state.qualifyPerGroup).forEach(r=>set.add(r.id)); });
    return set;
  }

  fmtPts(v){ return (Math.round(v*10)/10).toString(); }
  fmtDiff(v){ return v>0?`+${v}`:`${v}`; }

  bracketSeeds(){
    const qset=this.qualifierSet();
    const adv=this.allStandings().filter(r=>qset.has(r.id));
    return adv.map((r,i)=>({ id:r.id, name:r.name, seed:i+1, groupShort:r.groupShort }));
  }

  winnerOf(key, rd, idx, match){
    if(!match || !match.a || !match.b) return null;
    const wid=this.state.bracketWinners[`${key}-${rd}-${idx}`];
    if(wid){ if(match.a.id===wid)return match.a; if(match.b.id===wid)return match.b; }
    return null;
  }

  buildBracket(seeds, key){
    const pos=[0,7,3,4,2,5,1,6];
    const r0=[]; for(let i=0;i<4;i++) r0.push({ a:seeds[pos[i*2]]||null, b:seeds[pos[i*2+1]]||null });
    const rounds=[r0]; let prev=r0;
    for(let rd=1; rd<3; rd++){
      const cur=[];
      for(let i=0;i<prev.length/2;i++){ cur.push({ a:this.winnerOf(key,rd-1,i*2,prev[i*2]), b:this.winnerOf(key,rd-1,i*2+1,prev[i*2+1]) }); }
      rounds.push(cur); prev=cur;
    }
    const champ=this.winnerOf(key,2,0,prev[0]);
    return { rounds, champ };
  }

  bracketViewFor(key){
    const seeds=this.bracketSeeds();
    const list = key==='W' ? seeds.slice(0,8) : seeds.slice(8,16);
    // reindex seeds within bracket
    const local = list.map((s,i)=>({ ...s, localSeed:i+1 }));
    const built=this.buildBracket(local, key);
    const labels=['Round of 8','Semifinals','Final'];
    const sel = key==='W' ? 1 : 3;
    const rounds=built.rounds.map((matches,rd)=>({
      label: labels[rd],
      matches: matches.map((m,idx)=>{
        const wid=this.state.bracketWinners[`${key}-${rd}-${idx}`];
        const cell=(p,who)=>{
          const isWin = p && wid===p.id;
          const base='display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:9px 11px;background:transparent;border:0;cursor:pointer;color:var(--color-text);text-align:left;font-size:13px;font-family:inherit';
          const style = !p ? base+';color:var(--color-neutral-600);cursor:default' : isWin ? base+';background:var(--color-accent-800);color:var(--color-accent-100);font-weight:600' : base;
          return { name: p?p.name:'TBD', seed: p?('#'+p.localSeed):'', style, onClick: p?()=>this.advance(key,rd,idx,p.id):()=>{} };
        };
        const A=cell(m.a), B=cell(m.b);
        return { aName:A.name, aSeed:A.seed, aStyle:A.style, onA:A.onClick, bName:B.name, bSeed:B.seed, bStyle:B.style, onB:B.onClick };
      })
    }));
    return { rounds, champName: built.champ ? built.champ.name : 'TBD', selValue:sel };
  }

  advance(key, rd, idx, pid){ this.setState(s=>({ bracketWinners:{ ...s.bracketWinners, [`${key}-${rd}-${idx}`]: pid } })); }

  parseTranscript(t, aFirst, bFirst){
    const low=(t||'').toLowerCase();
    let winner=null;
    if (/halve|all square|\bas\b/.test(low)) winner='H';
    else if (low.includes(aFirst.toLowerCase())) winner='A';
    else if (low.includes(bFirst.toLowerCase())) winner='B';
    let margin='';
    const m1=low.match(/(\d+)\s*(?:&|and)\s*(\d+)/);
    const m2=low.match(/(\d+)\s*up/);
    if (winner==='H') margin='AS';
    else if (m1) margin=`${m1[1]}&${m1[2]}`;
    else if (m2) margin=`${m2[1]} UP`;
    return { winner, margin };
  }

  toggleListen(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR){ this.setState({ listenError:'Speech recognition not supported in this browser.' }); return; }
    if (this.state.listening){ this._rec && this._rec.stop(); return; }
    const rec = new SR(); this._rec=rec;
    rec.lang='en-US'; rec.interimResults=false; rec.maxAlternatives=1;
    const m=this.state.matches.find(x=>x.id===this.state.activeMatchId);
    const aFirst=this.player(m.aId).name.split(' ')[0], bFirst=this.player(m.bId).name.split(' ')[0];
    rec.onresult=(e)=>{ const t=e.results[0][0].transcript; const parsed=this.parseTranscript(t, aFirst, bFirst);
      this.setState(s=>({ resultForm:{ ...s.resultForm, winner: parsed.winner||s.resultForm.winner, margin: parsed.margin||s.resultForm.margin }, listenError:null })); };
    rec.onerror=()=>this.setState({ listening:false, listenError:'Could not hear a result — try again.' });
    rec.onend=()=>this.setState({ listening:false });
    this.setState({ listening:true, listenError:null });
    rec.start();
  }

  applyMatchResult(){
    const mid=this.state.activeMatchId; const { winner, margin } = this.state.resultForm;
    const m=this.state.matches.find(x=>x.id===mid); if(!m) return;
    const total=m.holes.length;
    let played=total, lead=0;
    const txt=(margin||'').trim().toUpperCase();
    if (winner==='H'){ played=total; lead=0; }
    else {
      const mm=txt.match(/^(\d+)\s*&\s*(\d+)$/);
      const uu=txt.match(/^(\d+)\s*UP$/);
      if (mm){ lead=parseInt(mm[1]); played=total-parseInt(mm[2]); }
      else if (uu){ lead=parseInt(uu[1]); played=total; }
      else { lead=1; played=total; }
      played=Math.max(lead, Math.min(total, played));
    }
    const holes=Array(total).fill(null);
    for (let i=0;i<played;i++) holes[i] = i<lead ? (winner==='A'?'A':'B') : 'H';
    this.setState(s=>({ matches: s.matches.map(x=> x.id!==mid ? x : { ...x, holes }) }));
  }

  setHole(mid, i, mark){
    this.setState(s=>({ matches: s.matches.map(m=> m.id!==mid ? m : { ...m, holes: m.holes.map((h,j)=> j===i ? (h===mark?null:mark) : h) }) }));
  }
  clearActive(){ const id=this.state.activeMatchId; this.setState(s=>({ matches: s.matches.map(m=> m.id!==id ? m : { ...m, holes: m.holes.map(()=>null) }) })); }

  regen(){ this.setState(s=>{ const groups=this.formGroups(s.players, s.groupRule); const matches=this.seedMatches(this.buildMatches(groups,'s0'), s.players); const fp=matches.find(m=>!this.res(m).complete)||matches[0]; return { groups, matches, activeMatchId:fp.id, rrGroupId:groups[0].id }; }); }

  addSignup(){
    const name=(this.state.signupForm.name||'').trim(); if(!name) return;
    const hcp=Math.max(0, Math.round(this.state.signupForm.handicap||0));
    this.setState(s=>{
      const id='p'+s.nextSignupId;
      const entry={ id, name, handicap:hcp };
      let players=s.players, waitlist=s.waitlist;
      if (players.length < s.event.capacity) players=[...players, { ...entry, seed:players.length+1 }];
      else waitlist=[...waitlist, entry];
      return { players, waitlist, nextSignupId:s.nextSignupId+1, signupForm:{ name:'', handicap:12 } };
    });
    this.regen();
  }

  applyManualCount(){
    this.setState(s=>{
      const target=Math.max(4, Math.round(s.event.manualPlayerCount)||s.players.length);
      let players=[...s.players], waitlist=[...s.waitlist], nextId=s.nextSignupId;
      while (players.length<target){ if (waitlist.length>0){ players.push({ ...waitlist.shift(), seed:players.length+1 }); } else { players.push({ id:'p'+nextId, name:`Player ${nextId+1}`, handicap:12, seed:players.length+1 }); nextId++; } }
      while (players.length>target){ waitlist.unshift(players.pop()); }
      return { players, waitlist, nextSignupId:nextId, event:{ ...s.event, capacity: Math.max(s.event.capacity, target) } };
    });
    this.regen();
  }

  importCsvText(text){
    const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const rows=lines.filter(l=>!/^name\s*,/i.test(l));
    this.setState(s=>{
      let players=[...s.players], waitlist=[...s.waitlist], nextId=s.nextSignupId;
      rows.forEach(line=>{
        const [name, hcpRaw]=line.split(',').map(x=>x&&x.trim());
        if (!name) return;
        const hcp=Math.max(0, Math.round(parseFloat(hcpRaw))||12);
        const entry={ id:'p'+nextId, name, handicap:hcp }; nextId++;
        if (players.length < s.event.capacity) players.push({ ...entry, seed:players.length+1 }); else waitlist.push(entry);
      });
      return { players, waitlist, nextSignupId:nextId };
    });
    this.regen();
  }
  handleCsvFile(e){
    const file=e.target.files && e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>this.importCsvText(String(reader.result||''));
    reader.readAsText(file);
    e.target.value='';
  }

  sendWhatsApp(){ window.open(`https://wa.me/?text=${encodeURIComponent(this.state.inviteMessage)}`, '_blank'); }
  copyInvite(){ navigator.clipboard && navigator.clipboard.writeText(this.state.inviteMessage); }

  removeSignup(id, fromWaitlist){
    this.setState(s=>{
      if (fromWaitlist) return { waitlist: s.waitlist.filter(p=>p.id!==id) };
      let players = s.players.filter(p=>p.id!==id).map((p,i)=>({ ...p, seed:i+1 }));
      let waitlist = s.waitlist;
      if (waitlist.length>0 && players.length < s.event.capacity){ const [next,...rest]=waitlist; players=[...players,{ ...next, seed:players.length+1 }]; waitlist=rest; }
      return { players, waitlist };
    });
    this.regen();
  }

  exportCSV(){
    const rows=this.allStandings(); const qset=this.qualifierSet();
    const head=['Rank','Player','Group','Played','Wins','Halves','Losses','HolesWon','HolesLost','Points','Status'];
    const lines=[head.join(',')].concat(rows.map(r=>[r.overall,`"${r.name}"`,r.groupShort,r.played,r.w,r.t,r.l,r.hw,r.hl,this.fmtPts(r.pts), qset.has(r.id)?'Advancing':'Eliminated'].join(',')));
    const blob=new Blob([lines.join('\n')],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nocturne-cup-standings.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  renderVals(){
    const S=this.state, ev=S.event;
    const nav = k => () => this.setState({ screen:k });
    const allScreens=['dashboard','event','registration','roster','grouping','stages','rr','scoring','qual','bracket','scorecard','entry','leaderboard','reports','access'];
    const playerScreens=['dashboard','entry','leaderboard'];
    const effScreen = S.role==='player' && !playerScreens.includes(S.screen) ? 'dashboard' : S.screen;
    const show = {}; allScreens.forEach(k=>show[k]=effScreen===k);

    const navBase='display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:8px;font-size:13.5px;cursor:pointer;text-decoration:none;color:var(--color-neutral-300)';
    const navActive=navBase+';background:var(--color-accent-900);color:var(--color-accent-100);box-shadow:inset 0 0 0 1px var(--color-accent-700)';
    const mkItem=(key,label,icon)=>({ key,label,icon:'ph '+icon, onClick:nav(key), style: S.screen===key?navActive:navBase });
    const navSections = S.role==='player' ? [
      { label:'Overview', items:[ mkItem('dashboard','Dashboard','ph-gauge') ] },
      { label:'Play', items:[ mkItem('entry','Score entry','ph-pencil-simple'), mkItem('leaderboard','Live leaderboard','ph-ranking') ] },
    ] : [
      { label:'Overview', items:[ mkItem('dashboard','Dashboard','ph-gauge') ] },
      { label:'Setup', items:[ mkItem('event','Event setup','ph-flag-banner'), mkItem('registration','Registration','ph-user-plus'), mkItem('roster','Player roster','ph-users'), mkItem('grouping','Grouping rules','ph-users-three'), mkItem('stages','Stage builder','ph-stack'), mkItem('rr','Round robin setup','ph-arrows-clockwise'), mkItem('scoring','Scoring rules','ph-medal') ] },
      { label:'Compete', items:[ mkItem('qual','Qualification','ph-funnel'), mkItem('bracket','Bracket manager','ph-tree-structure') ] },
      { label:'Scoring', items:[ mkItem('scorecard','Scorecard generator','ph-cards'), mkItem('entry','Score entry','ph-pencil-simple'), mkItem('leaderboard','Live leaderboard','ph-ranking') ] },
      { label:'Output', items:[ mkItem('reports','Reports & export','ph-export') ] },
      { label:'Admin', items:[ mkItem('access','Access control','ph-shield-check') ] },
    ];

    // standings
    const standings=this.allStandings();
    const qset=this.qualifierSet();
    const badge = rank => rank<=3 ? 'display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--color-accent-800);color:var(--color-accent-100);font-size:12px;font-weight:600' : 'color:var(--color-neutral-400);font-variant-numeric:tabular-nums';
    const leaderRow = r => ({ rank:r.overall, name:r.name, group:r.groupShort, record:`${r.w}-${r.t}-${r.l}`, diffText:this.fmtDiff(r.diff), ptsText:this.fmtPts(r.pts), badge:badge(r.overall), played:r.played, w:r.w, t:r.t, l:r.l, rowStyle: qset.has(r.id)?'':'' });
    const leaderTop = standings.slice(0,8).map(leaderRow);
    const leaderFull = standings.map(r=>{ const o=leaderRow(r); o.rowStyle = qset.has(r.id) ? 'box-shadow:inset 3px 0 0 var(--color-accent)' : ''; return o; });

    // groups view (mini standings)
    const miniBase='display:flex;gap:8px;font-size:12px;padding:3px 0';
    const groupsView=S.groups.map(gr=>{
      const rows=this.groupStandings(gr);
      return { id:gr.id, name:gr.name, rows: rows.map(r=>{
        const q = r.rank<=S.qualifyPerGroup;
        return { rank:r.rank, short:r.name, ptsText:this.fmtPts(r.pts),
          miniStyle: miniBase + (q?';color:var(--color-accent-200);font-weight:500':';color:var(--color-neutral-300)'),
          qualRowStyle: q?'box-shadow:inset 3px 0 0 var(--color-accent)':'opacity:.6',
          qualTag: q?'ADV':'—', qualTagClass: q?'tag tag-accent':'tag tag-neutral' };
      }) };
    });

    // stats
    const s0=S.matches.filter(m=>m.stageId==='s0');
    const done=s0.filter(m=>this.res(m).complete).length;
    const pct=Math.round(done/s0.length*100);
    const statCards=[
      { label:'Players', value:''+S.players.length, sub:'8 groups of 4', icon:'ph ph-users' },
      { label:'Matches', value:`${done}/${s0.length}`, sub:`${pct}% complete`, icon:'ph ph-flag-checkered' },
      { label:'Current stage', value:'Stage 1', sub:'Round Robin', icon:'ph ph-arrows-clockwise' },
      { label:'Advancing', value:''+qset.size, sub:`top ${S.qualifyPerGroup} per group`, icon:'ph ph-funnel' },
    ];
    const cutoff = standings.length ? this.fmtPts(standings[Math.min(qset.size, standings.length-1)]?.pts || 0) : '0';
    const bracketStatus=[
      { name:'Winners bracket', detail:'8 seeds · R8', icon:'ph ph-trophy' },
      { name:'Consolation bracket', detail:'8 seeds · R8', icon:'ph ph-medal' },
    ];

    // roster
    const rosterRows=[...S.players].sort((a,b)=>a.seed-b.seed).map(p=>{
      const row=standings.find(r=>r.id===p.id);
      const g=this.groupOf(p.id);
      return { seed:p.seed, name:p.name, handicap:p.handicap, group:g?g.name.replace('Group ','Grp '):'—', record: row?`${row.w}-${row.t}-${row.l}`:'0-0-0', ptsText: row?this.fmtPts(row.pts):'0' };
    });

    // grouping
    const ruleMeta={ balanced:{label:'Balanced skill',icon:'ph ph-scales',desc:'Snake draft by handicap so every group has a comparable spread of ability — fairest for competitive group play.'}, handicap:{label:'By handicap',icon:'ph ph-chart-bar',desc:'Banded by handicap: lowest handicaps in Group A, highest in the last group. Groups play within their tier.'}, seeding:{label:'By seeding',icon:'ph ph-list-numbers',desc:'Snake draft by ranking seed so seeded strength is distributed evenly across groups.'}, manual:{label:'Manual',icon:'ph ph-hand-pointing',desc:'Groups follow roster order; drag players between groups to assign by hand.'} };
    const ruleBtn='display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;background:transparent;color:var(--color-text)';
    const ruleOptions=Object.keys(ruleMeta).map(k=>({ label:ruleMeta[k].label, icon:'ph '+ruleMeta[k].icon.replace('ph ',''), style: ruleBtn + (S.groupRule===k ? ';border:1px solid var(--color-accent);color:var(--color-accent);background:color-mix(in srgb,var(--color-accent) 10%,transparent)' : ';border:1px solid var(--color-divider)'), pick: ()=>this.setState({groupRule:k}) }));
    const groupsFull=S.groups.map(gr=>{ const pls=gr.playerIds.map(id=>this.player(id)); const avg=(pls.reduce((s,p)=>s+p.handicap,0)/pls.length).toFixed(1); return { name:gr.name, avgHcp:avg, players: pls.map(p=>({ name:p.name, tag:`#${p.seed} · ${p.handicap}` })) }; });

    // stages
    const stageStatus=['Complete','In progress','Upcoming','Upcoming'];
    const stageTag=['tag tag-neutral','tag tag-accent','tag tag-outline','tag tag-outline'];
    const stageIcons=['ph ph-arrows-clockwise','ph ph-arrows-clockwise','ph ph-funnel','ph ph-tree-structure'];
    const setStageDeadline=(id)=>(e)=>{ const v=e.target.value; this.setState(s=>({ stages: s.stages.map(st=>st.id===id?{...st,deadline:v}:st) })); };
    const toggleCarry=(id)=>()=>this.setState(s=>({ stages: s.stages.map(st=>st.id===id?{...st,carryForwardEnabled:!st.carryForwardEnabled}:st) }));
    const setCarryPct=(id)=>(e)=>{ const v=parseInt(e.target.value)||0; this.setState(s=>({ stages: s.stages.map(st=>st.id===id?{...st,carryForwardPct:v}:st) })); };
    const sampleStandings=this.allStandings();
    const samplePlayer = sampleStandings[0];
    const stagesView=S.stages.map((st,i)=>{
      const carryPct = st.carryForwardPct||0;
      const carried = samplePlayer ? (samplePlayer.pts*carryPct/100) : 0;
      return { n:i+1, type:st.type, desc:st.desc, status:stageStatus[i], tagClass:stageTag[i], icon:stageIcons[i], deadline:st.deadline, setDeadline:setStageDeadline(st.id),
      badgeBg: i===1?'var(--color-accent-900)':'var(--color-neutral-800)', badgeColor: i===1?'var(--color-accent-200)':'var(--color-neutral-300)', wrapExtra: i===1?'box-shadow:inset 0 0 0 1px var(--color-accent-700), var(--shadow-sm)':'' ,
      showCarry: i>0, carryEnabled: st.carryForwardEnabled, carryPct, carryPctText: carryPct+'%', carryDisabledAttr: !st.carryForwardEnabled,
      toggleCarry: toggleCarry(st.id), setCarryPct: setCarryPct(st.id),
      carryExample: st.carryForwardEnabled ? `E.g. ${samplePlayer?samplePlayer.name:'a player'} entering with ${samplePlayer?this.fmtPts(samplePlayer.pts):'0'} pts from the previous stage carries ${this.fmtPts(carried)} pts (${carryPct}%) into Stage ${i+1}.` : 'Disabled — this stage starts every player at zero points.' };
    });

    // rr setup
    const rrGroup=S.groups.find(g=>g.id===S.rrGroupId)||S.groups[0];
    const rrSched=this.schedule(rrGroup.playerIds);
    const rrRounds=rrSched.map((pairs,ri)=>({ n:ri+1, matches: pairs.map(([a,b])=>{ const m=S.matches.find(x=>x.groupId===rrGroup.id&&x.round===ri+1&&((x.aId===a&&x.bId===b)||(x.aId===b&&x.bId===a))); const rr=m?this.res(m):{complete:false,played:0}; return { a:this.player(a).name, b:this.player(b).name, status: rr.complete?'Final':rr.played>0?'Live':'Pending', tagClass: rr.complete?'tag tag-neutral':rr.played>0?'tag tag-accent':'tag tag-outline' }; }) }));
    const groupSelect=S.groups.map(g=>({ id:g.id, name:g.name, selected:g.id===S.rrGroupId }));

    // scoring
    const sc=S.scoring;
    const setSc = (f,parse) => (e)=>{ const v=parse(e.target.value); this.setState(s=>({ scoring:{ ...s.scoring, [f]: isNaN(v)?0:v } })); };
    const scoringFields=[
      { label:'Match win', hint:'Points for winning a match', step:'1', value:sc.winPts, onChange:setSc('winPts',parseFloat) },
      { label:'Halved match', hint:'Points each when all square', step:'0.5', value:sc.tiePts, onChange:setSc('tiePts',parseFloat) },
      { label:'Match loss', hint:'Points for a loss', step:'1', value:sc.lossPts, onChange:setSc('lossPts',parseFloat) },
      { label:'Hole-win ratio', hint:'Points per net hole won (tiebreak weight)', step:'0.05', value:sc.holeRatioPts, onChange:setSc('holeRatioPts',parseFloat) },
      { label:'Bonus', hint:'Flat bonus applied per player', step:'1', value:sc.bonusPts, onChange:setSc('bonusPts',parseFloat) },
    ];
    const tiebreakers=[ 'Head-to-head result','Holes-won ratio','Fewest holes lost','Lower handicap' ].map((t,i)=>({ n:i+1, label:t }));
    const scoringExample=`A player with 3 wins, 1 halve and 22 holes won scores ${this.fmtPts(3*sc.winPts+1*sc.tiePts+22*sc.holeRatioPts+sc.bonusPts)} pts under the current rules.`;

    // qualification
    const qualOptions=[1,2,3].map(n=>({ n, checked:S.qualifyPerGroup===n, pick:()=>this.setState({qualifyPerGroup:n}) }));

    // bracket
    const bracketTabs=[ {label:'Winners',key:'W'},{label:'Consolation',key:'C'} ].map(t=>({ label:t.label, checked:S.bracketTab===t.key, pick:()=>this.setState({bracketTab:t.key}) }));
    const bv=this.bracketViewFor(S.bracketTab);

    // scorecard
    const courses=this.courses();
    const courseOptions=courses.map(c=>({ name:c.name, selected:c.name===S.scForm.course }));
    const setScf=(f)=>(e)=>this.setState(s=>({ scForm:{ ...s.scForm, [f]:e.target.value } }));
    const applyPreset=(e)=>{ const c=courses.find(x=>x.name===e.target.value)||courses[0]; this.setState(s=>({ scForm:{ ...s.scForm, course:c.name, city:c.city, address:c.address } })); };
    const cObj=courses.find(c=>c.name===S.scForm.course)||courses[0];
    const start = S.scForm.holes===9 && S.scForm.nine==='back' ? 9 : 0;
    const count = S.scForm.holes===9 ? 9 : 18;
    const yardsFor=par=> par===3?165:par===5?520:400;
    const scPreview=[]; for(let i=0;i<count;i++){ const idx=start+i; const par=cObj.pars[idx]; scPreview.push({ num:idx+1, par, yards:yardsFor(par) }); }
    const scPar=scPreview.reduce((s,h)=>s+h.par,0);
    const scYards=scPreview.reduce((s,h)=>s+h.yards,0);
    const scForm={ ...S.scForm, is18:S.scForm.holes===18, is9:S.scForm.holes===9, isFront:S.scForm.nine==='front', isBack:S.scForm.nine==='back', lenLabel: (S.scForm.holes===9?`9 holes · ${S.scForm.nine==='front'?'front':'back'} nine`:'18 holes') };

    // score entry
    const activeM=S.matches.find(m=>m.id===S.activeMatchId)||s0[0];
    const matchPicker=s0.map(m=>{ const rr=this.res(m); const active=m.id===S.activeMatchId; const base='display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;border-radius:7px;cursor:pointer;font-family:inherit;border:1px solid transparent;background:transparent;color:var(--color-text)'; return { title:`${this.player(m.aId).name.split(' ')[0]} v ${this.player(m.bId).name.split(' ')[0]}`, sub:`${this.groupOf(m.aId).name.replace('Group ','Grp ')} · R${m.round}`, status: rr.complete?'Final':rr.played>0?'Live':'Open', tagClass: rr.complete?'tag tag-neutral':rr.played>0?'tag tag-accent':'tag tag-outline', style: base + (active?';background:var(--color-accent-900);border-color:var(--color-accent-700)':''), open:()=>this.setState({activeMatchId:m.id}) }; });
    const arr=this.res(activeM);
    const cellBtn='padding:6px 0;font-size:12px;cursor:pointer;border:0;background:transparent;color:var(--color-neutral-400);font-family:inherit;font-weight:600';
    const selA=cellBtn+';background:var(--color-accent);color:var(--color-accent-100)';
    const selH=cellBtn+';background:var(--color-neutral-600);color:var(--color-neutral-100)';
    const selB=cellBtn+';background:var(--color-accent-2-500);color:var(--color-accent-2-100)';
    const activeMatch={
      groupName:this.groupOf(activeM.aId).name, round:activeM.round,
      aName:this.player(activeM.aId).name, bName:this.player(activeM.bId).name,
      statusBig: arr.played===0?'—':(arr.lead===0?'All square':`${arr.lead>0?this.player(activeM.aId).name.split(' ')[0]:this.player(activeM.bId).name.split(' ')[0]} ${arr.resultText}`),
      statusSub: arr.complete?(arr.decided?'Match won (closed out)':'Final'):`${arr.played}/${arr.total} holes played`,
      holesWonText:`Holes won — ${this.player(activeM.aId).name.split(' ')[0]} ${arr.a} · Halved ${arr.played-arr.a-arr.b} · ${this.player(activeM.bId).name.split(' ')[0]} ${arr.b}`,
      holes: activeM.holes.map((h,i)=>({ label:'H'+(i+1), aStyle: h==='A'?selA:cellBtn, hStyle: h==='H'?selH:cellBtn, bStyle: h==='B'?selB:cellBtn, setA:()=>this.setHole(activeM.id,i,'A'), setH:()=>this.setHole(activeM.id,i,'H'), setB:()=>this.setHole(activeM.id,i,'B') })),
    };

    // reports
    const reportStats=[
      { label:'Players', value:''+S.players.length, sub:'across 8 groups' },
      { label:'Matches played', value:''+done, sub:`of ${s0.length} scheduled` },
      { label:'Advancing', value:''+qset.size, sub:'to bracket stage' },
      { label:'Leader', value: standings[0]?standings[0].name.split(' ')[0]:'—', sub: standings[0]?`${this.fmtPts(standings[0].pts)} pts`:'' },
    ];
    const exportList=[
      { name:'Full standings (CSV)', desc:'All players, records and points', icon:'ph ph-table' },
      { name:'Group results (CSV)', desc:'Per-group standings and matches', icon:'ph ph-users-three' },
      { name:'Bracket sheet (PDF)', desc:'Printable winners & consolation draw', icon:'ph ph-tree-structure' },
      { name:'Scorecards (PDF)', desc:'Match-play cards for the pilot event', icon:'ph ph-cards' },
    ];
    const reportRows=standings.map(r=>({ rank:r.overall, name:r.name, group:r.groupShort, ptsText:this.fmtPts(r.pts), statusTag: qset.has(r.id)?'Advancing':'Out', tagClass: qset.has(r.id)?'tag tag-accent':'tag tag-neutral' }));

    // events (login)
    const events=[
      { name:'Nocturne Cup — Spring Pilot', meta:'May 14–16, 2026 · Ridgeline National · 32 players', status:'Live', tagClass:'tag-accent', open:()=>this.setState({loggedIn:true,screen:'dashboard'}) },
      { name:'Autumn Invitational', meta:'Oct 2–3, 2026 · Harbor Dunes · 48 players', status:'Draft', tagClass:'tag-neutral', open:()=>this.setState({loggedIn:true,screen:'event'}) },
      { name:'Winter Match Series', meta:'Jan 2027 · Cedar Hollow · 24 players', status:'Draft', tagClass:'tag-neutral', open:()=>this.setState({loggedIn:true,screen:'event'}) },
    ];

    const eventSummary=[ {k:'Players',v:''+S.players.length}, {k:'Groups',v:`${S.groups.length} groups`}, {k:'Stages',v:'4'}, {k:'Format',v: ev.format==='match'?'Match play':'Stroke play'} ];

    const setSignupName=(e)=>this.setState(s=>({signupForm:{...s.signupForm,name:e.target.value}}));
    const setSignupHandicap=(e)=>this.setState(s=>({signupForm:{...s.signupForm,handicap:parseFloat(e.target.value)||0}}));
    const signupRowsConfirmed=S.players.map(p=>({ seed:p.seed, name:p.name, handicap:p.handicap, remove:()=>this.removeSignup(p.id,false) }));
    const signupRowsWaitlist=S.waitlist.map((p,i)=>({ seed:i+1, name:p.name, handicap:p.handicap, remove:()=>this.removeSignup(p.id,true) }));
    const spotsLeft=Math.max(0, S.event.capacity - S.players.length);
    const regStatusText = spotsLeft>0 ? 'Open' : 'Full — waitlist active';

    return {
      loggedIn:S.loggedIn, notLoggedIn:!S.loggedIn, show, navSections,
      logout:()=>this.setState({loggedIn:false}), events,
      goDashboard:nav('dashboard'), goEntry:nav('entry'), goLeaderboard:nav('leaderboard'), goBracket:nav('bracket'),
      ev:{ ...ev, isMatch:ev.format==='match', isStroke:ev.format==='stroke', isCountReg:ev.playerCountMode==='registration', isCountManual:ev.playerCountMode==='manual' }, playersCount:S.players.length,
      setCountModeReg:()=>this.setState(s=>({event:{...s.event,playerCountMode:'registration'}})),
      setCountModeManual:()=>this.setState(s=>({event:{...s.event,playerCountMode:'manual'}})),
      setManualCount:(e)=>this.setState(s=>({event:{...s.event,manualPlayerCount:parseInt(e.target.value)||0}})),
      applyManualCount:()=>this.applyManualCount(),
      importCsv:(e)=>this.handleCsvFile(e), goRegistration:()=>this.setState({screen:'registration'}),
      inviteMessage:S.inviteMessage, setInviteMessage:(e)=>this.setState({inviteMessage:e.target.value}), sendWhatsApp:()=>this.sendWhatsApp(), copyInvite:()=>this.copyInvite(),
      setEvName:(e)=>this.setState(s=>({event:{...s.event,name:e.target.value}})), setEvDates:(e)=>this.setState(s=>({event:{...s.event,dates:e.target.value}})), setEvCourse:(e)=>this.setState(s=>({event:{...s.event,course:e.target.value}})), setEvCity:(e)=>this.setState(s=>({event:{...s.event,city:e.target.value}})), setEvAddr:(e)=>this.setState(s=>({event:{...s.event,address:e.target.value}})), setFmtMatch:()=>this.setState(s=>({event:{...s.event,format:'match'}})), setFmtStroke:()=>this.setState(s=>({event:{...s.event,format:'stroke'}})),
      setRegDeadline:(e)=>this.setState(s=>({event:{...s.event,regDeadline:e.target.value}})), setCapacity:(e)=>this.setState(s=>({event:{...s.event,capacity:Math.max(4,parseInt(e.target.value)||0)}})),
      eventSummary, waitlistCount:S.waitlist.length, spotsLeft, regStatusText, signupForm:S.signupForm, setSignupName, setSignupHandicap, addSignup:()=>this.addSignup(), signupRowsConfirmed, signupRowsWaitlist,
      statCards, leaderTop, leaderFull, groupsView, stageName:'Stage 1 · Round Robin', stageSub:'Group play in progress', pctText:pct+'%', matchesDoneText:`${done} of ${s0.length}`, matchesDone:done, bracketStatus, qualPerGroup:S.qualifyPerGroup, qualCount:qset.size, cutoffText:cutoff,
      rosterRows,
      ruleOptions, ruleDesc:ruleMeta[S.groupRule].desc, regenGroups:()=>this.regen(), groupsFull,
      stagesView,
      rrRounds, rrGroupName:rrGroup.name, rrTotal:s0.length, groupSelect, setRrGroup:(e)=>this.setState({rrGroupId:e.target.value}),
      scoringFields, tiebreakers, scoringExample,
      qualOptions,
      bracketTabs, bracketView:bv.rounds, champName:bv.champName,
      courseOptions, applyPreset, scForm, setScCity:setScf('city'), setScAddr:setScf('address'), set18:()=>this.setState(s=>({scForm:{...s.scForm,holes:18}})), set9:()=>this.setState(s=>({scForm:{...s.scForm,holes:9}})), setFront:()=>this.setState(s=>({scForm:{...s.scForm,nine:'front'}})), setBack:()=>this.setState(s=>({scForm:{...s.scForm,nine:'back'}})), scPreview, scPar, scYards,
      matchPicker, activeMatch, clearMatch:()=>this.clearActive(),
      entryModeHoles:S.entryMode==='holes', entryModeResult:S.entryMode==='result',
      setModeHoles:()=>this.setState({entryMode:'holes'}), setModeResult:()=>this.setState({entryMode:'result'}),
      resultForm:{ ...S.resultForm, isA:S.resultForm.winner==='A', isH:S.resultForm.winner==='H', isB:S.resultForm.winner==='B' },
      setResultA:()=>this.setState(s=>({resultForm:{...s.resultForm,winner:'A'}})), setResultH:()=>this.setState(s=>({resultForm:{...s.resultForm,winner:'H'}})), setResultB:()=>this.setState(s=>({resultForm:{...s.resultForm,winner:'B'}})),
      setResultMargin:(e)=>this.setState(s=>({resultForm:{...s.resultForm,margin:e.target.value}})),
      applyResult:()=>this.applyMatchResult(), toggleListen:()=>this.toggleListen(),
      micIcon: S.listening ? 'ph-fill ph-microphone' : 'ph ph-microphone',
      micStyle: S.listening ? 'color:var(--color-accent);border-color:var(--color-accent)' : '',
      listenHint: S.listening ? 'Listening… say e.g. "Marcus wins 3 and 2"' : (S.listenError || 'Tap the mic and say the result, e.g. "3 and 2" or "all square".'),
      isAdminRole:S.role==='admin', isPlayerRole:S.role==='player',
      setRoleAdmin:()=>this.setState({role:'admin'}), setRolePlayer:()=>this.setState(s=>({role:'player', screen: playerScreens.includes(s.screen)?s.screen:'dashboard'})),
      activeAccount: (()=>{ const acc = S.role==='admin' ? S.accounts.find(a=>a.role==='admin') : S.accounts.find(a=>a.role==='player'); const parts=acc.name.split(' '); return { name:acc.name, initials:(parts[0][0]+(parts[1]?parts[1][0]:'')).toUpperCase(), roleLabel: acc.role==='admin'?'Organizer · full access':'Player · read-only + score entry' }; })(),
      accountRows: S.accounts.map(a=>({ name:a.name, email:a.email, radioName:'role-'+a.id, isAdmin:a.role==='admin', isPlayer:a.role==='player',
        makeAdmin:()=>this.setState(s=>({accounts:s.accounts.map(x=>x.id===a.id?{...x,role:'admin'}:x)})),
        makePlayer:()=>this.setState(s=>({accounts:s.accounts.map(x=>x.id===a.id?{...x,role:'player'}:x)})),
        remove:()=>this.setState(s=>({accounts:s.accounts.filter(x=>x.id!==a.id)})) })),
      accountForm:{ ...S.accountForm, isAdmin:S.accountForm.role==='admin', isPlayer:S.accountForm.role==='player' },
      setAccName:(e)=>this.setState(s=>({accountForm:{...s.accountForm,name:e.target.value}})),
      setAccEmail:(e)=>this.setState(s=>({accountForm:{...s.accountForm,email:e.target.value}})),
      setAccAdmin:()=>this.setState(s=>({accountForm:{...s.accountForm,role:'admin'}})),
      setAccPlayer:()=>this.setState(s=>({accountForm:{...s.accountForm,role:'player'}})),
      addAccount:()=>this.setState(s=>{ if(!s.accountForm.name.trim()) return {}; return { accounts:[...s.accounts,{ id:'a'+s.nextAccountId, name:s.accountForm.name, email:s.accountForm.email, role:s.accountForm.role }], nextAccountId:s.nextAccountId+1, accountForm:{name:'',email:'',role:'player'} }; }),
      reportStats, exportList, reportRows, exportCSV:()=>this.exportCSV(), printPage:()=>window.print(),
    };
  }
}
</script>
</body>
</html>
