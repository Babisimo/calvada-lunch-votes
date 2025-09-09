import { db } from '../../../firebaseConfig';
import {
  collection, query, where, getDocs,
  doc, getDoc, setDoc, serverTimestamp
} from 'firebase/firestore';
import { normalizeChoices } from '../utils/normalizeChoices';

export type WinnerRecord = {
  week: string;
  winner: string;
  choices: string[];
  tally: Record<string, number>;
  decidedAt: any; // Firestore Timestamp
  source: 'auto' | 'manual';
};

export async function decideAndPersistWinner(weekKey: string): Promise<WinnerRecord | null> {
  if (!weekKey) return null;

  // If already decided, just return it.
  const winnerRef = doc(db, 'winners', weekKey);
  const existing = await getDoc(winnerRef);
  if (existing.exists()) return existing.data() as WinnerRecord;

  // Load weekly options
  const weeklyRef = doc(db, 'weeklyOptions', weekKey);
  const weeklySnap = await getDoc(weeklyRef);
  if (!weeklySnap.exists()) return null;
  const choices = normalizeChoices(weeklySnap.data()?.choices);

  // Tally votes
  const q = query(collection(db, 'votes'), where('week', '==', weekKey));
  const votesSnap = await getDocs(q);
  const tally: Record<string, number> = {};
  for (const v of votesSnap.docs) {
    const c = String(v.data().choice ?? '').trim();
    if (!c) continue;
    tally[c] = (tally[c] || 0) + 1;
  }

  // Ensure every weekly choice appears in tally (even with 0)
  for (const c of choices) {
    if (!(c in tally)) tally[c] = 0;
  }

  // Decide winner (random tiebreaker among max)
  const maxCount = Math.max(0, ...Object.values(tally));
  const topChoices = Object.keys(tally).filter(c => tally[c] === maxCount);
  if (topChoices.length === 0) return null; // no data at all
  const winner = topChoices[Math.floor(Math.random() * topChoices.length)];

  const payload: WinnerRecord = {
    week: weekKey,
    winner,
    choices,
    tally,
    decidedAt: serverTimestamp(),
    source: 'auto',
  };

  // Write once (if doc still doesn’t exist)
  const latestCheck = await getDoc(winnerRef);
  if (!latestCheck.exists()) {
    await setDoc(winnerRef, payload);
  }
  const finalDoc = await getDoc(winnerRef);
  return finalDoc.data() as WinnerRecord;
}
