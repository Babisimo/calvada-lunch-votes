/**
 * Vote document IDs are deterministic: "{weekKey}_{uid}".
 *
 * This is what makes one-vote-per-week enforceable. firestore.rules requires
 * the ID to match this shape and denies updates, so a second vote lands on an
 * existing path and is rejected — no query, no race between browser tabs.
 *
 * Keep in sync with the `voteId ==` check in firestore.rules.
 */
export function voteDocId(weekKey: string, uid: string): string {
  return `${weekKey}_${uid}`;
}
