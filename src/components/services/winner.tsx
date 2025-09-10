import { db } from '../../../firebaseConfig';
import {
  collection, query, where, getDocs,
  doc, getDoc, setDoc, serverTimestamp
} from 'firebase/firestore';
import { normalizeChoices } from '../utils/normalizeChoices';

export type WeeklyWinner = {
  name: string;
  tally: Record<string, number>;
  decidedAt: any; // Firestore Timestamp
  source: 'auto' | 'manual';
};

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'number') return v;
  return 0;
}

/**
 * Decide the week's winner and persist it INSIDE weeklyOptions/{weekKey}.winner.
 * Returns { name, tally, decidedAt, source } or null.
 * IMPORTANT: If totalVotes == 0, we DO NOT pick/write a winner.
 */
export async function decideAndPersistWinnerInWeeklyDoc(weekKey: string): Promise<WeeklyWinner | null> {
  if (!weekKey) return null;

  const weeklyRef = doc(db, 'weeklyOptions', weekKey);
  const weeklySnap = await getDoc(weeklyRef);
  if (!weeklySnap.exists()) return null;

  const data = weeklySnap.data() as any;
  const choices = normalizeChoices(data?.choices);
  const updatedAtMs = toMillis(data?.updatedAt);
  const existingWinner = data?.winner;

  // If there's already a winner decided AFTER the last options update, reuse it
  if (existingWinner && toMillis(existingWinner.decidedAt) >= updatedAtMs) {
    return existingWinner as WeeklyWinner;
  }

  // Tally votes for this week
  const qVotes = query(collection(db, 'votes'), where('week', '==', weekKey));
  const votesSnap = await getDocs(qVotes);

  const tally: Record<string, number> = {};
  votesSnap.forEach(v => {
    const c = String(v.data().choice ?? '').trim();
    if (!c) return;
    tally[c] = (tally[c] || 0) + 1;
  });

  // Ensure all choices appear (even 0)
  for (const c of choices) if (!(c in tally)) tally[c] = 0;

  const entries = Object.entries(tally);
  if (entries.length === 0) return null;

  const totalVotes = entries.reduce((sum, [, count]) => sum + (count as number), 0);
  if (totalVotes === 0) {
    // No votes at all → do NOT select/write a winner
    return null;
  }

  const maxCount = Math.max(0, ...entries.map(([, count]) => count as number));
  const top = entries.filter(([, count]) => (count as number) === maxCount).map(([name]) => name);
  const winnerName = top[Math.floor(Math.random() * top.length)] || '';

  const payload: WeeklyWinner = {
    name: winnerName,
    tally,
    decidedAt: serverTimestamp(),
    source: 'auto',
  };

  // Merge only the winner field into the weekly doc
  await setDoc(weeklyRef, { winner: payload }, { merge: true });

  // Read back to get server timestamp value
  const final = await getDoc(weeklyRef);
  return (final.data()?.winner ?? null) as WeeklyWinner | null;
}
