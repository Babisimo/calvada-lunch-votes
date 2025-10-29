import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';

/**
 * Subscribes to weekly options by docId (primary) with a fallback query by `week` field.
 * Calls `onData(null)` if nothing found.
 */
export function subscribeWeeklyOptions(
  weekKey: string,
  onData: (data: any | null) => void
) {
  const ref = doc(db, 'weeklyOptions', weekKey);
  const qByField = query(collection(db, 'weeklyOptions'), where('week', '==', weekKey));

  let usedFallback = false;

  const unsubPrimary = onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      onData(snap.data());
    } else if (!usedFallback) {
      usedFallback = true;
      onSnapshot(qByField, (qsnap) => {
        const first = qsnap.docs[0];
        onData(first ? first.data() : null);
      });
    } else {
      onData(null);
    }
  });

  return () => unsubPrimary();
}
