import { useEffect, useState } from 'react';
import { db } from '../../../firebaseConfig';
import { doc, onSnapshot } from 'firebase/firestore';

// Fallback: PST reset on Wednesday @ 12:00 PM PT
export const computePSTWednesdayNoonWeekKey = () => {
  const nowUTC = new Date();
  const nowPST = new Date(
    nowUTC.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  );

  const resetHour = 12; // noon
  const resetDay = 3;   // Wed (0=Sun)
  const day = nowPST.getDay();
  const hour = nowPST.getHours();

  let wednesday = new Date(nowPST);
  if (day < resetDay || (day === resetDay && hour < resetHour)) {
    const diff = (7 + day - resetDay) % 7 || 7;
    wednesday.setDate(nowPST.getDate() - diff);
  } else {
    const diff = (day - resetDay);
    wednesday.setDate(nowPST.getDate() - diff);
  }
  wednesday.setHours(resetHour, 0, 0, 0);

  const year = wednesday.getFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((wednesday.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000));

  return `${year}-W${week}`;
};

export const useWeekKey = () => {
  const [weekKey, setWeekKey] = useState<string>(computePSTWednesdayNoonWeekKey());

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'currentWeek'), (snap) => {
      const val = snap.exists() ? snap.data()?.value : null;
      if (typeof val === 'string' && val.trim()) {
        setWeekKey(val.trim());
      } else {
        setWeekKey(computePSTWednesdayNoonWeekKey());
      }
    });
    return () => unsub();
  }, []);

  return weekKey;
};
