import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';

function nextIsoWeek(weekKey: string): string | null {
  // weekKey: "YYYY-Www"
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const ww = parseInt(m[2], 10);

  // Use Jan 4th as ISO anchor
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = (jan4.getUTCDay() + 6) % 7; // Mon=0
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - dayOfWeek);

  const mondayThis = new Date(firstMonday);
  mondayThis.setUTCDate(firstMonday.getUTCDate() + (ww - 1) * 7);

  const mondayNext = new Date(mondayThis);
  mondayNext.setUTCDate(mondayThis.getUTCDate() + 7);

  // Compute next ISO year/week
  const target = new Date(mondayNext);
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  const y2 = target.getUTCFullYear();
  return `${y2}-W${String(week).padStart(2, '0')}`;
}

export default function AdminWeekControl() {
  const [currentWeek, setCurrentWeek] = useState('');
  const [input, setInput] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'currentWeek'), (snap) => {
      const val = snap.exists() ? snap.data()?.value : '';
      setCurrentWeek(typeof val === 'string' ? val : '');
      setInput(typeof val === 'string' ? val : '');
    });
    return () => unsub();
  }, []);

  const saveWeek = async (wk: string) => {
    if (!/^20\d{2}-W\d{2}$/.test(wk)) {
      toast.error('Use format YYYY-Www (e.g., 2025-W43)');
      return;
    }
    await setDoc(doc(db, 'config', 'currentWeek'), { value: wk }, { merge: true });
    // Scaffold weeklyOptions/{wk}
    await setDoc(doc(db, 'weeklyOptions', wk), { week: wk, updatedAt: serverTimestamp() }, { merge: true });
    toast.success(`Current Week set to ${wk}`);
  };

  const handleSave = async () => {
    const wk = input.trim();
    try { await saveWeek(wk); } catch (e) { console.error(e); toast.error('Failed to set week'); }
  };

  const handleNewWeek = async () => {
    const next = nextIsoWeek(currentWeek || input);
    if (!next) { toast.error('Invalid current week. Set it first.'); return; }
    try { await saveWeek(next); } catch (e) { console.error(e); toast.error('Failed to create new week'); }
  };

  return (
    <section className="bg-white p-6 rounded-xl shadow border border-gray-200">
      <h3 className="text-lg font-semibold mb-4 text-center">🗓️ Current Week</h3>
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. 2025-W43"
          className="px-4 py-2 w-full sm:w-60 border border-gray-300 bg-white text-gray-900 rounded"
        />
        <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition">
          💾 Save Week
        </button>
        <button onClick={handleNewWeek} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded transition">
          ➕ New Week
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-2 text-center">
        Current: <b>{currentWeek || '— not set —'}</b>
      </p>
    </section>
  );
}
