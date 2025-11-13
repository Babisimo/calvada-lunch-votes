// src/components/VotingTimerAdmin.tsx
import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import {
  doc, setDoc, onSnapshot, getDoc,
  runTransaction, deleteField
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { useWeekKey } from './utils/useWeekKey';

const GRACE_MS = 60_000;

export default function VotingTimerAdmin() {
  const weekKey = useWeekKey();
  const configRef = doc(db, 'config', 'votingConfig');

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState('');
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(configRef, (snap) => {
      const data = snap.data();
      if (data?.start) setStart(data.start);
      if (data?.end) setEnd(data.end);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!start || !end) return;
      const now = Date.now();
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      if (Number.isNaN(s) || Number.isNaN(e)) {
        setStatus('❌ Invalid date format');
        setCountdown(''); return;
      }
      if (now < s) { setStatus('⏳ Voting has not started yet'); setCountdown(fmt(e - now)); }
      else if (now > e) { setStatus('🛑 Voting has ended'); setCountdown(''); }
      else { setStatus('✅ Voting is live!'); setCountdown(fmt(e - now)); }
    }, 1000);
    return () => clearInterval(id);
  }, [start, end]);

  function fmt(ms: number) {
    const t = Math.max(0, Math.floor(ms/1000));
    const h = String(Math.floor(t/3600)).padStart(2,'0');
    const m = String(Math.floor((t%3600)/60)).padStart(2,'0');
    const s = String(t%60).padStart(2,'0');
    return `${h}:${m}:${s}`;
  }

  async function maybeClearWinnerOnExtend(prevEndISO: string | null | undefined, newEndISO: string) {
    if (!weekKey || !newEndISO) return;

    const prevEnd = prevEndISO ? new Date(prevEndISO).getTime() : null;
    const newEnd = new Date(newEndISO).getTime();
    if (!newEnd || Number.isNaN(newEnd)) return;

    // Only act if the end was extended
    const extended = prevEnd !== null && !Number.isNaN(prevEnd) && newEnd > prevEnd;
    if (!extended) return;

    const ref = doc(db, 'weeklyOptions', weekKey);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() as any;
      const decidedAt = data?.winner?.decidedAt;
      const decidedMs =
        decidedAt?.toMillis?.() ??
        (typeof decidedAt === 'object' && decidedAt?.seconds ? decidedAt.seconds*1000 : 0);

      // Clear if the winner was decided before (or at) the original end (+grace)
      if (data?.winner && decidedMs <= (prevEnd! + GRACE_MS)) {
        tx.set(ref, { winner: deleteField() }, { merge: true });
      }
    });
  }

  const handleSave = async () => {
    if (!start || !end) {
      toast.error('Please select both start and end times.');
      return;
    }
    try {
      // Read previous end
      const prevSnap = await getDoc(configRef);
      const prevEnd = prevSnap.exists() ? prevSnap.data()?.end : null;

      // Save new timer
      await setDoc(configRef, { start, end });
      toast.success('Voting timer updated!');

      // If you extended the end for this week, clear stale winner (auto)
      await maybeClearWinnerOnExtend(prevEnd, end);
    } catch (err) {
      console.error(err);
      toast.error('Failed to update timer.');
    }
  };

  return (
    <div className="bg-white mt-10 p-6 rounded-xl shadow-md border border-gray-200 text-center max-w-xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">🕒 Voting Timer Config</h2>

      <div className="flex flex-col gap-4 mb-6">
        <label className="text-left font-medium">
          🟢 Start Date & Time:
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2"
          />
        </label>

        <label className="text-left font-medium">
          🔴 End Date & Time:
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2"
          />
        </label>
      </div>

      <button
        onClick={handleSave}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
      >
        💾 Save Timer
      </button>

      <div className="mt-6 text-center space-y-1">
        <p className="text-sm text-gray-500">{status}</p>
        {countdown && <p className="text-2xl font-mono text-indigo-600">{countdown}</p>}
      </div>
    </div>
  );
}
