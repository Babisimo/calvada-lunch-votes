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

  const winnerRef = doc(db, 'winners', weekKey);
  const prior = await getDoc(winnerRef);
  if (prior.exists()) return prior.data() as WinnerRecord;

  const weeklyRef = doc(db, 'weeklyOptions', weekKey);
  const weeklySnap = await getDoc(weeklyRef);
  if (!weeklySnap.exists()) return null;

  const choices = normalizeChoices(weeklySnap.data()?.choices);
  const q = query(collection(db, 'votes'), where('week', '==', weekKey));
  const votesSnap = await getDocs(q);

  const tally: Record<string, number> = {};
  votesSnap.forEach(v => {
    const c = String(v.data().choice ?? '').trim();
    if (!c) return;
    tally[c] = (tally[c] || 0) + 1;
  });

  // Ensure all choices appear (even 0)
  for (const c of choices) if (!(c in tally)) tally[c] = 0;

  const maxCount = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter(k => tally[k] === maxCount);
  if (top.length === 0) return null;

  const winner = top[Math.floor(Math.random() * top.length)];

  const payload: WinnerRecord = {
    week: weekKey,
    winner,
    choices,
    tally,
    decidedAt: serverTimestamp(),
    source: 'auto',
  };

  const latest = await getDoc(winnerRef);
  if (!latest.exists()) await setDoc(winnerRef, payload);

  const finalDoc = await getDoc(winnerRef);
  return finalDoc.data() as WinnerRecord;
}
