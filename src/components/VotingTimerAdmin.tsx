import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import toast from 'react-hot-toast';

export default function VotingTimerAdmin() {
  const configRef = doc(db, 'config', 'votingConfig');

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState('');
  const [countdown, setCountdown] = useState('');

  // Helper
  function isoWeekKeyFromLocal(startIsoLocal: string): string {
    // startIsoLocal is like "2025-10-27T07:00" (local)
    const d = new Date(startIsoLocal); // local time
    // ISO week algorithm
    const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    // Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
    const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
    );
    const year = target.getUTCFullYear();
    const ww = String(week).padStart(2, '0');
    return `${year}-W${ww}`;
  }

  useEffect(() => {
    const unsub = onSnapshot(configRef, (snap) => {
      const data = snap.data();
      if (data?.start && data?.end) {
        setStart(data.start);
        setEnd(data.end);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!start || !end) return;

      const now = new Date();
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        setStatus('❌ Invalid date format');
        setCountdown('');
        return;
      }

      if (now < startDate) {
        setStatus('⏳ Voting has not started yet');
        setCountdown(timeDiff(now, startDate));
      } else if (now > endDate) {
        setStatus('🛑 Voting has ended');
        setCountdown('');
      } else {
        setStatus('✅ Voting is live!');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [start, end]);

  function timeDiff(now: Date, target: Date) {
    const diff = Math.floor((target.getTime() - now.getTime()) / 1000);
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  const handleSave = async () => {
    if (!start || !end) {
      toast.error('Please select both start and end times.');
      return;
    }

    try {
      const weekKey = isoWeekKeyFromLocal(start);

      await setDoc(configRef, { start, end }, { merge: true });
      // 🔑 single source of truth for the whole app:
      await setDoc(doc(db, 'config', 'currentWeek'), { value: weekKey }, { merge: true });

      toast.success(`Voting timer updated! Week set to ${weekKey}`);
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
        {countdown && (
          <p className="text-2xl font-mono text-indigo-600">{countdown}</p>
        )}
      </div>
    </div>
  );
}
