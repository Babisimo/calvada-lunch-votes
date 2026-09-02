# Handoff — UI overhaul + security hardening

**Written:** 2026-08-04 · **Last updated:** 2026-09-02
**Branch:** `main`
**Firebase project:** `calvada-lunch-voting-project`
**Hosting:** Vercel, deploys on push to `main`

---

## Status at a glance

| Thing | State |
|---|---|
| Firestore rules + indexes | **Deployed to production** |
| Frontend code | **Committed and deployed** |
| Vercel env vars | **Set** (confirmed 2026-09-01) |
| `config/currentWeek` | `2026-W36` — correct as of 2026-09-02 |
| `config/votingConfig` | **Re-saved with numeric `startMs`/`endMs`** — see the gotcha |
| Coin-flip tiebreaker | Exercised end to end in production (2026-W36, 7–7) |
| Cloud Function (`functions/`) | Written, deliberately NOT deployed |

Voting works, and a tied week has now been settled for real.

Two production breakages were found and fixed, both of the same shape — a rule
and a client disagreeing about a stored value:

```
1. deployed frontend:  addDoc(collection(db, 'votes'), ...)  -> random doc ID
   deployed rules:     voteId == currentWeek() + '_' + uid   -> denied every vote

2. every client:       Date.parse(votingConfig.end)          -> "voting closed"
   deployed rules:     votingConfig.endMs, absent -> 0       -> denied every winner
```

The second silently blocked *all* winner writes for a month, automatic ones
included, while voting kept working perfectly. Firestore was healthy throughout
both. See **Gotchas found the hard way**.

---

## Open items

**Watch the week-key banner.** `/admin` compares `config/currentWeek` against
today's real ISO week and says so out loud when they disagree — it caught a
`2025-W36` year typo where `2026-W36` was meant. Resolved, but if it appears
again, decide with the vote count in hand:

- **Nobody has voted yet** → set the correct key in *Current week*, then draw
  the options again, because `weeklyOptions/{week}` is per-key.
- **People have already voted** → leave it for this cycle and fix at the next
  rollover. Changing the key mid-cycle points voting at a week with no ballot
  doc, which re-breaks voting (see the `get()` note under *Contracts*), and
  strands the votes already cast under the old key.

Do not use "Start next week" to jump a long distance — it advances exactly one
week per click.

**Verify end to end after any week change.** Set a short voting window, cast a
real vote, confirm it lands and the winner resolves after close.

### Two Firestore docs must exist for the current week

Both are read with `get()` inside the rules, and `get()` on a missing document
makes the whole rule error out — which surfaces as `permission-denied`, not as
an empty ballot:

- `weeklyOptions/{week}` — `firestore.rules:97`, via `ballotChoices()`. Missing
  → **nobody can vote.**
- `config/votingConfig` — `firestore.rules:66`, via `withinVotingWindow()`.
  Missing `startMs`/`endMs` fails *open* so voting still works, but
  `votingHasClosed()` then never returns true and **no winner is ever written**.
  Re-saving the timer in `/admin` writes them.

### Vercel env vars

Six `VITE_FIREBASE_*` values, already set. If the project is ever rebuilt from
scratch, `.env` is untracked so the build has no config without them, and the
app white-screens on `apiKey: undefined`. Values are in `.env.example`'s shape
and in the Firebase console under Project settings → Your apps. **Paste without
quotes** — Vite strips quotes from `.env`, Vercel does not, and they end up
inside the string.

These are **not secrets**. Every `VITE_` variable is inlined into the client
bundle at build time and is already public in the deployed JavaScript. Nothing
needs rotating. The rules are what protect the data.

---

## Contracts — do not break these

### Vote document IDs
`votes/{weekKey}_{uid}` — see `src/components/utils/voteDocId.ts`. This is the
*entire* one-vote-per-week mechanism: a second vote targets an existing path,
which is an update, and `firestore.rules` denies updates. Changing the ID shape
means changing the matching `voteId ==` check in the rules.

### Ties are never resolved automatically
`Leaderboard.tsx` detects a tie for the top spot and **writes nothing**. That is
deliberate and load-bearing, not an oversight:

`firestore.rules` allows exactly **one** winner write per voting window
(`decidedForEndMs`). Spending it on an automatic pick makes that pick permanent
and uncorrectable. The old behaviour handed ties to whichever option was drawn
first on the ballot — invisible, and biased toward ballot position.

A tie now waits for an admin to flip a coin in `/admin` (`AdminTieBreaker.tsx`).
The admin's browser throws it once, writes the result tagged
`viaFlip: true` + `tiedBetween: [...]`, and every visitor's `CoinFlip` component
*replays* that recorded result. **The coin never decides anything** — if it never
ran, the winner would be identical. That separation is what makes it safe.

**No rules change was needed.** The winner-write path is gated on `isCalvada()`,
which an `@calvada.com` admin already satisfies, and extra subfields inside
`winner` are unconstrained. An admin whose email is *not* `@calvada.com` could
not flip — no such admin exists today.

Tie detection lives in one place, `utils/tie.ts`. The repo previously carried
three tiebreakers that disagreed (ballot order here, ballot order in
`functions/index.js`, `Math.random()` in a dead `services/winner.tsx`, since
deleted). If you deploy the Cloud Function, its tiebreak must be changed to
match — bail on a tie rather than resolving it.

#### The click battle is built, and deliberately switched off
`ClickBattle.tsx` and `utils/battle.ts` are a working timed click battle — admin
sets a duration, everyone piles onto a side, most clicks wins. It was tested
against live Firestore and then pulled: fun, but it turned settling a lunch vote
into an event that demanded everyone's attention. **Do not re-propose it without
being asked.**

Nothing imports either file, so both are tree-shaken out of the bundle and cost
production nothing. Each carries a header with the exact steps to re-wire it.
The `tieBreakers` block in `firestore.rules` stays deployed and is marked
DORMANT — it is inert without a battle document, which nothing creates now, so
reviving the feature needs no rules change. Safe to delete if it is abandoned.

Four things that cost real time, if it ever comes back:
- **Buffer clicks, never write per click.** A write per click pushes a snapshot
  to every listener per click; a 20-second battle with ten people burns roughly
  a fifth of the daily free-tier READ quota, and when that runs out *voting*
  starts failing, not just the game.
- **Counts must be absolute, not `increment()`** — an increment is opaque to
  security rules, so it cannot be held to monotonic growth or a rate cap.
- **Never mix the server's echo of your own count with your unwritten local
  clicks.** A flush advances the local baseline before the snapshot carrying it
  arrives, so the scoreboard collapses and snaps back twice a second. Own count
  local, everyone else's from Firestore.
- **Rules must accept writes slightly past the deadline.** The final buffered
  flush necessarily lands after the whistle; without a grace window the last
  half-second of everyone's clicks is thrown away, which decides exactly the
  close battles. Settlement then has to wait out that window too.

### Design tokens
`src/index.css` is the single source of truth. Everything reads tokens
(`bg-brand-600`, `text-ink-muted`, `rounded-card`), nothing reads raw Tailwind
palette classes. Re-skinning is one `@theme` block.

**There is no `tailwind.config.ts`.** Tailwind v4 is CSS-first; a config file
would be silently ignored.

Brand is Calvada green `#238d4f`:
- `brand-500` **is** `#238d4f` — 4.2:1 on white, so **fills and large type only**
- `brand-600` `#1f8148` — 4.9:1, used for anything carrying white text
- Interaction uses `--color-brand-hover` / `--color-brand-active`, not ramp
  steps, because the ramp inverts under dark mode
- `--color-on-brand` is the text color that sits on a brand fill; it flips in
  dark mode where the greens lighten

**Green is IDENTITY, not result.** It appears in exactly three places: the
wordmark, the confirm button, and the "your vote is in" mark. Every affirmative
*result* state (winner, selected option, on-ballot) uses `stamp-*` instead —
green-as-winning on a cool ground was what made the app read as a betting slip.
`success-*` is reserved for toast icons only.

`danger-*` is warmed so it doesn't read as a stray cool red on kraft, but stays
more saturated than `stamp-*` so the two remain distinguishable. They never
share a screen: stamp is decorative and affirmative, danger is destructive and
admin-only.

### Dark mode — opt-in, not OS-driven
Token overrides live in one `:root[data-theme="dark"]` block. No `dark:`
variants in any component, and it should stay that way.

**It is deliberately NOT keyed to `prefers-color-scheme`.** The kraft ticket is
the identity of the app, so everyone gets it by default — including people whose
OS is set to dark. Night shift is a choice made with the header toggle and
remembered per browser in `localStorage`.

Three pieces have to stay in sync:
- `src/index.css` — bare `:root` is the complete light palette and the fallback
  when JavaScript never runs; `:root[data-theme="dark"]` overrides it.
- `src/components/utils/theme.ts` — reads, applies and persists the choice.
- The inline `<script>` in `index.html` — paints the stored theme *before* first
  paint, otherwise anyone on dark gets a flash of kraft on every load. It
  duplicates the storage key and the accepted values on purpose; changing either
  means changing both.

`ThemeToggle` is mounted in both headers (`App.tsx` and `AdminDashboard.tsx`).
The two instances don't share React state — they never appear together, and each
initialises from storage.

Saturated accents LIGHTEN in dark: `#b33a2b` measures 2.9:1 on the dark ground
and is unreadable, so `stamp-600` becomes `#e0705c` at 5.4:1.

### Winner shape
Both the browser tally and the optional Cloud Function write the identical
object, including `decidedForEndMs`. That field is what stops them fighting and
what makes extending the timer re-open the decision.

A flip-settled week additionally carries `viaFlip: true` and
`tiedBetween: [...]`. **Those two are not decoration** — they are what lets the
result state, permanently, that a choice was made rather than a winner appearing
from nowhere. Don't drop them from the payload.

### The flip is evidence, not an animation
The point of the coin is to show that a real decision happened between two named
options. That requirement is served by the *record*, not the motion:

- The result permanently reads `TIE 7–7 · SETTLED BY COIN FLIP` with both names,
  built from `tiedBetween` and `tally`, so it survives reloads and works for
  anyone who never saw the coin.
- A **Watch the flip** button replays it on demand — the animation is otherwise
  once per person per week (`localStorage` key `calvada-lunch-flip-seen`), and a
  one-shot you can miss is not evidence.
- The coin plays in the **admin panel** too. The person who flips was previously
  the one person guaranteed not to see it, because the animation lives in
  Leaderboard and `/admin` doesn't render it. That required the settled-panel
  early return to yield, or the panel vanished mid-spin as the write landed.
- The faces carry the two dish names. `.coin-label` condenses Archivo to
  `wdth 82` to fit them; long single words break rather than spilling out.
  Landing on the front face isn't a spoiler — at five turns in 2.2s neither side
  is readable until it stops.

---

## What changed

### Security (the real gap)
Everything was previously enforced client-side only — the `@calvada.com` check
and one-vote-per-week were both trivially bypassable from a devtools console.

`firestore.rules` now enforces: verified `@calvada.com` only; one vote per person
per week; votes must name a choice actually on that week's ballot and carry the
caller's own uid/email; votes immutable once cast, admin-delete only; menu,
ballot, week and timer are admin-only.

`config/votingConfig` now carries numeric `startMs`/`endMs` alongside the ISO
strings, because rules cannot parse a `datetime-local` string. **If those are
ever missing, the window check is skipped and no winner can be written** —
re-saving the timer in `/admin` fixes it.

### Correctness
- `AdminVotersPage` was loading *every vote ever cast* while claiming to show the
  current week. Now scoped, with a week box that follows the live week.
- Winner blurb used `Math.random()` in a `useMemo` — different users saw
  different copy for the same event. Now hash-seeded on `weekKey`.
- Leaderboard bars were colored by array index, so they **swapped colors whenever
  the ranking changed**. The bars are gone entirely as of the Order Ticket
  reskin — the tally is a receipt dot leader now.
- `window.clearWinnerOnce` debug leak removed from `AdminDashboard`.
- Danger buttons got *lighter* on hover (`bg-red-900 hover:bg-red-700`).

### Accessibility
Global `:focus-visible` ring; ballot is a `fieldset`/`legend` with full-width row
tap targets; raw counts shown next to percentages; decorative emoji are
`aria-hidden`; `prefers-reduced-motion` kills every animation including confetti
and the stamp landing.

Two things changed with the reskin and should not be reintroduced:
- `role="progressbar"` was dropped along with the bar it described. There is no
  bar to describe.
- The tally rows carry **no `aria-label`.** An `aria-label` on a listitem
  overrides its text content in several screen readers; the row already reads
  "Thai Basil Chicken 7 · 41%" on its own.

The winner is still not marked by color alone — the word ORDERED and the dish
name inside the stamp both carry it, and the blurb is kept as `sr-only` text.

### Design — "Order Ticket"
See the long comment at the top of `src/index.css` for the direction and its
three rules. Type is **Archivo** (loaded with its *width* axis, not just
weight), **Newsreader** for body, **Martian Mono** for counts. Radius is 0
everywhere; the torn top edge (`.paper-tear`) carries the character instead.

Everything else from the first pass still stands: lucide icons for controls with
emoji kept for expression only, staggered entrance animations, skeletons, custom
confirm dialog replacing `window.confirm()`, error boundary, per-route titles,
lazy-loaded admin chunks.

---

## Deliberate trade-offs

**The winner is tallied in the browser.** Whichever client loads first after
closing time writes it. The rules constrain this hard — the name must have been
on the ballot, `decidedAt` must equal the server clock, and one decision per
window — so a winner cannot be invented, backdated, or flip-flopped. What it
cannot prevent is a determined insider choosing *which real option* gets
recorded.

Closing that gap requires deploying `functions/index.js`, which requires the
**Blaze plan** (Cloud Functions cannot deploy on Spark at all). **This was
considered and declined** — cost would be ~$0 but it needs a billing account.
`functions/README.md` has the full switch-over, including the three-line rules
change. Do not re-propose this without being asked.

Slack winner announcements live inside that function, so they are off too.

---

## Gotchas found the hard way

- **The voting window is stored TWICE, and only the numbers count.**
  `config/votingConfig` holds `start`/`end` as ISO strings for the
  datetime-local inputs and `startMs`/`endMs` as numbers. **Rules cannot parse a
  datetime string, so they only ever read the numbers.** Every client used to
  parse the string instead, and a config document written before the numeric
  fields existed made the two disagree completely: the app was certain voting
  had closed and offered to settle the week, while the rules saw `endMs = 0`,
  concluded voting had never closed, and denied *every* winner write — automatic
  ones included — for a month.

  It hid because `withinVotingWindow()` fails **open** on a missing field while
  `votingHasClosed()` fails **closed**. Voting worked perfectly; only recording a
  result was broken, and nothing surfaced it until someone tried to settle a tie.

  `utils/votingWindow.ts` is now the single reader: it takes `endMs`
  authoritatively, falls back to the strings for display only, and reports
  `needsResave` so the UI can say so instead of guessing. Anything that has to
  agree with the server reads that helper, never the raw document.
  **Re-saving the timer in `/admin` writes the numeric fields.**
- **`CoinFlip`'s timers must not depend on `onDone`.** Leaderboard re-renders
  every second from its countdown tick, so an inline arrow as an effect
  dependency tore the timers down and rebuilt them once a second — the coin
  never landed, the winner was never revealed, and `onDone` never fired. It is
  held in a ref now and the sequence runs once, from mount. Same trap for any
  animation whose parent ticks.
- **Tailwind v4 tree-shakes unused theme values.** `#238d4f` was absent from the
  compiled CSS until something actually referenced `brand-500`. Verify tokens
  survive the build, don't assume.
- **`styles.css` was a dev/prod divergence, not a 404.** Vite's dev server serves
  project-root files, so it loaded on localhost; `vite build` only copies
  `public/`, so it was silently missing in production. Its contents are now in
  `src/index.css`.
- **`.env` was feeding the Vercel build** via the repo checkout. Untracking it
  breaks the build until env vars are set.
- Rules can't be syntax-checked locally without the Firestore emulator, which
  needs Java (not installed). `firebase deploy` validates on upload; the console
  Rules Playground checks without publishing.

---

## Open items

- **Favicon and wordmark** — `public/favicon.ico` is still the Vite default and
  the header uses a placeholder lockup (green square + utensils icon). Waiting on
  a real Calvada asset.
- **Dead template files could not be deleted** (blocked by a permission
  classifier). All are inert — nothing imports or links them:
  ```
  git rm styles.css src/App.css tailwind.config.ts public/vite.svg src/assets/react.svg
  ```
- **Results are visible before you vote**, which anchors people toward the
  leader. Left alone deliberately — that's a product decision.
- **`useWeekKey` has no automatic rollover** by design. The dashboard shows an
  amber banner when the set week doesn't match today's ISO week
  (`src/components/utils/isoWeek.ts`).
- **Bundle is ~738 kB / 200 kB gzip**, dominated by Firebase. Admin routes are
  already split out; further gains need Firebase modular trimming.
- **Proportion is no longer readable at a glance.** The dot leader gives an exact
  count, not an approximate length. The percentage on each line and the TOTAL row
  are what carry sample size now. Inherent to the direction, not an oversight.
- **The tally has no upper bound on option count.** Five options fit the ticket
  comfortably; a dozen would want a scroll or a cut-off, and nothing enforces one.
- **`collectionGroup` queries on `/votes` are denied.** The rules only match
  `/votes/{voteId}` at the top level, so the collection-group listener in
  `AdminDashboard` always fails and falls back to the top-level query. It works,
  but logs `Missing or insufficient permissions` on every admin load. Noise, not
  breakage — either add a `match /{path=**}/votes/{voteId}` read rule or drop the
  collectionGroup path.
- **Resetting a settled week needs the Firebase console.** Rules deliberately
  forbid admins from touching a decided `winner` — that is the no-flip-flopping
  guarantee — so re-running a tie means deleting the `winner` field by hand *and*
  clearing the `localStorage` key `calvada-lunch-flip-seen`, or the animation
  won't replay for you.
