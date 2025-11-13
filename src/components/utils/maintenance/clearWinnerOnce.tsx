// utils/maintenance/clearWinnerOnce.ts
import { db } from '../../../../firebaseConfig';
import { doc, runTransaction, deleteField } from 'firebase/firestore';

export async function clearWinnerOnce(weekKey: string) {
  const ref = doc(db, 'weeklyOptions', weekKey);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    if (data?.winner) {
      tx.set(ref, { winner: deleteField() }, { merge: true });
    }
  });
}
