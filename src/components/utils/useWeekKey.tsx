// import { useEffect, useState } from 'react';
// import { db } from '../../../firebaseConfig';
// import { doc, onSnapshot } from 'firebase/firestore';

// // existing PST-based fallback
// export const computePSTWednesdayNoonWeekKey = () => {
//   const nowUTC = new Date();
//   const nowPST = new Date(nowUTC.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
//   const resetHour = 12; // noon
//   const resetDay = 3;   // Wed (0=Sun)
//   const day = nowPST.getDay();
//   const hour = nowPST.getHours();
//   let wednesday = new Date(nowPST);
//   if (day < resetDay || (day === resetDay && hour < resetHour)) {
//     const diff = (7 + day - resetDay) % 7 || 7;
//     wednesday.setDate(nowPST.getDate() - diff);
//   } else {
//     const diff = (day - resetDay);
//     wednesday.setDate(nowPST.getDate() - diff);
//   }
//   wednesday.setHours(resetHour, 0, 0, 0);
//   const year = wednesday.getFullYear();
//   const startOfYear = new Date(Date.UTC(year, 0, 1));
//   const week = Math.ceil((wednesday.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000));
//   return `${year}-W${String(week).padStart(2,'0')}`;
// };

// function isoWeekKeyFromLocal(startIsoLocal: string): string | null {
//   if (!startIsoLocal) return null;
//   const d = new Date(startIsoLocal);
//   if (Number.isNaN(d.getTime())) return null;
//   const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
//   const dayNr = (target.getUTCDay() + 6) % 7;
//   target.setUTCDate(target.getUTCDate() - dayNr + 3);
//   const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
//   const week = 1 + Math.round(
//     ((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
//   );
//   const year = target.getUTCFullYear();
//   return `${year}-W${String(week).padStart(2,'0')}`;
// }

// export const useWeekKey = () => {
//   const [weekKey, setWeekKey] = useState<string>(computePSTWednesdayNoonWeekKey());

//   useEffect(() => {
//     // listen to currentWeek first
//     const unsubCurrentWeek = onSnapshot(doc(db, 'config', 'currentWeek'), (snap) => {
//       const val = snap.exists() ? snap.data()?.value : null;
//       if (typeof val === 'string' && val.trim()) {
//         setWeekKey(val.trim());
//       } else {
//         // if currentWeek not set, peek at votingConfig.start
//         const unsubVoting = onSnapshot(doc(db, 'config', 'votingConfig'), (vsnap) => {
//           const start = vsnap.exists() ? vsnap.data()?.start : '';
//           const alt = isoWeekKeyFromLocal(start);
//           if (alt) setWeekKey(alt);
//           else setWeekKey(computePSTWednesdayNoonWeekKey());
//         });
//         // cleanup for the inner listener when currentWeek appears later
//         return () => unsubVoting();
//       }
//     });

//     return () => unsubCurrentWeek();
//   }, []);

//   return weekKey;
// };

import { useEffect, useState } from 'react';
import { db } from '../../../firebaseConfig';
import { doc, onSnapshot } from 'firebase/firestore';

/**
 * Manual-only week key.
 * - Reads config/currentWeek.value
 * - If missing, shows an empty string so UIs can render a friendly message.
 * - NO automatic fallbacks, NO automatic writes.
 */
export const useWeekKey = () => {
  const [weekKey, setWeekKey] = useState<string>('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'currentWeek'), (snap) => {
      const val = snap.exists() ? snap.data()?.value : '';
      if (typeof val === 'string' && val.trim()) setWeekKey(val.trim());
      else setWeekKey(''); // force admin to set it explicitly
    });
    return () => unsub();
  }, []);

  return weekKey;
};
