# Handoff — UI overhaul + security hardening

**Date:** 2026-08-04
**Branch:** `main` (all work uncommitted at time of writing)
**Firebase project:** `calvada-lunch-voting-project`
**Hosting:** Vercel, deploys on push to `main`

---

## Status at a glance

| Thing | State |
|---|---|
| Firestore rules + indexes | **Deployed to production** |
| Frontend code | **Not committed, not deployed** |
| Vercel env vars | **Missing — must be added before push** |
| `config/currentWeek` | **Stale: `2025-W46`, should be `2026-W32`** |
| Cloud Function (`functions/`) | Written, deliberately NOT deployed |

> The deployed rules and the deployed frontend currently **disagree**. Live voting
> is broken until the frontend ships — the old code writes votes with random
> document IDs and the new rules require `{week}_{uid}`. This is safe only because
> voting is finished for the current cycle.

---

## Do this first

**1. Add six env vars in Vercel** (Production + Preview + Development).
`.env` used to be committed, which is how Vercel was getting these. It is now
untracked, so the build has no config without them. **Paste values without
quotes** — Vite strips quotes from `.env`; Vercel does not, and they end up
inside the string.

```
VITE_FIREBASE_API_KEY=AIzaSyAExWDo5EaDARANhZMTMliJu8re7yqXBEw
VITE_FIREBASE_AUTH_DOMAIN=calvada-lunch-voting-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=calvada-lunch-voting-project
VITE_FIREBASE_STORAGE_BUCKET=calvada-lunch-voting-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=715081829912
VITE_FIREBASE_APP_ID=1:715081829912:web:4a0d808efa42cab310bd6d
```

These are **not secrets**. Every `VITE_` variable is inlined into the client
bundle at build time and is already public in the deployed JavaScript. Nothing
needs rotating. The rules are what protect the data.

**2. Commit and push to `main`.** Vercel builds automatically.

**3. Roll the week forward.** In `/admin`, type `2026-W32` into *Current week*
and press **Save week**. Do not use "Start next week" — it advances exactly one
week, so it would take 38 clicks. Then draw options for the new week.

While the week is stale, votes are recorded against `2025-W46`, and anyone who
voted in that week **cannot vote again** — the deterministic document ID
collides and the rules reject it as an update.

**4. Verify end to end.** Set a short voting window, cast a vote, confirm it
lands and the winner resolves after close.

---

## Contracts — do not break these

### Vote document IDs
`votes/{weekKey}_{uid}` — see `src/components/utils/voteDocId.ts`. This is the
*entire* one-vote-per-week mechanism: a second vote targets an existing path,
which is an update, and `firestore.rules` denies updates. Changing the ID shape
means changing the matching `voteId ==` check in the rules.

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
  the ranking changed**. All one brand green now; length encodes standing.
- `window.clearWinnerOnce` debug leak removed from `AdminDashboard`.
- Danger buttons got *lighter* on hover (`bg-red-900 hover:bg-red-700`).

### Accessibility
Global `:focus-visible` ring; ballot is a `fieldset`/`legend` with card-sized tap
targets; `role="progressbar"` with aria labels; raw counts shown next to
percentages; winner marked by crown + label, not color alone; decorative emoji
are `aria-hidden`; `prefers-reduced-motion` kills every animation including
confetti.

### Design
Token layer, Bricolage Grotesque + Inter, lucide icons for controls with emoji
kept for expression only, staggered entrance animations, skeletons, custom
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
- **Nothing has been tested against live Firebase with a real vote.** The rules
  are deployed but unexercised.
