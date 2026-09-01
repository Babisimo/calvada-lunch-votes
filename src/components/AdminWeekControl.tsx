import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { CalendarDays, Plus, Save } from 'lucide-react';
import { btn, btnSize, cn, field, label, panel, sectionTitle } from './ui/styles';

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
      toast.error('Use the format YYYY-Www, e.g. 2025-W43');
      return;
    }
    await setDoc(doc(db, 'config', 'currentWeek'), { value: wk }, { merge: true });
    // Scaffold weeklyOptions/{wk}
    await setDoc(doc(db, 'weeklyOptions', wk), { week: wk, updatedAt: serverTimestamp() }, { merge: true });
    toast.success(`Current week is now ${wk}`);
  };

  const handleSave = async () => {
    const wk = input.trim();
    try { await saveWeek(wk); } catch (e) { console.error(e); toast.error("Couldn't set the week"); }
  };

  const handleNewWeek = async () => {
    const next = nextIsoWeek(currentWeek || input);
    if (!next) { toast.error('Set a valid current week first'); return; }
    try { await saveWeek(next); } catch (e) { console.error(e); toast.error("Couldn't start a new week"); }
  };

  return (
    <section className={cn(panel, 'flex flex-col p-5 sm:p-6')}>
      <div className="mb-4 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-field bg-brand-50 text-brand-700"
        >
          <CalendarDays size={16} strokeWidth={2.25} />
        </span>
        <h2 className={sectionTitle}>Current week</h2>
      </div>

      <label htmlFor="week-key" className={label}>
        Week key
      </label>
      <input
        id="week-key"
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        placeholder="2025-W43"
        data-numeric
        className={cn(field, 'mt-1.5')}
      />
      <p className="mt-1.5 text-sm text-ink-subtle">
        Live: <b className="font-semibold text-ink" data-numeric>{currentWeek || 'not set'}</b>
      </p>

      <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row">
        <button onClick={handleSave} className={cn(btn.primary, btnSize.md, 'flex-1')}>
          <Save size={16} strokeWidth={2.25} aria-hidden="true" />
          Save week
        </button>
        <button onClick={handleNewWeek} className={cn(btn.secondary, btnSize.md, 'flex-1')}>
          <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
          Start next week
        </button>
      </div>
    </section>
  );
}
