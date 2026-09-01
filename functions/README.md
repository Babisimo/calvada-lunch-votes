# Optional: scheduled winner decision

**This is not deployed and is not required.** The app decides the winner in the
browser — see the `useEffect` in `src/components/Leaderboard.tsx`. This directory
is a drop-in replacement for that, kept here for whenever it's worth turning on.

It is deliberately left out of `firebase.json`, so `firebase deploy` will not try
to push it.

## What it buys you

| | Browser tally (current) | Scheduled function |
|---|---|---|
| Winner is decided | when someone opens the page after closing time | within 5 minutes, always |
| Who can record it | any verified `@calvada.com` account | only the server |
| Slack announcement | no | yes, if a webhook is set |
| Requires Blaze plan | no | **yes** |

The browser tally is safe against invented, backdated, or flip-flopped winners —
`firestore.rules` enforces all three. What it cannot prevent is a determined
insider choosing *which of the real ballot options* gets recorded, since their
browser is the one doing the counting. If that matters, deploy this.

## Turning it on

Cloud Functions cannot be deployed on the free Spark plan at all, so the project
must be on **Blaze (pay-as-you-go)** first. Real cost for this workload is
effectively zero — ~8,600 invocations/month against a 2M free allowance — but a
billing account is required.

1. Upgrade the project to Blaze in the Firebase console.
2. Add this back to `firebase.json`:

   ```json
   "functions": [
     { "source": "functions", "codebase": "default", "ignore": ["node_modules", ".git"] }
   ]
   ```

3. Install and deploy:

   ```
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```

4. Optional Slack announcement:

   ```
   firebase functions:secrets:set SLACK_WEBHOOK_URL
   firebase deploy --only functions
   ```

5. Close the remaining gap by making the winner server-only. In
   `firestore.rules`, change the second `allow update` on `weeklyOptions` (the
   `isCalvada()` one) to `allow update: if false;` — the Admin SDK bypasses
   rules, so the function keeps working. Then delete the winner-deciding
   `useEffect` from `Leaderboard.tsx`.

Both paths write the same `winner` shape and both stamp `decidedForEndMs`, so
they will not fight if they briefly overlap.
