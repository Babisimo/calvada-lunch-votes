// src/components/VotingTimerAdmin.tsx
import { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Clock, Save } from 'lucide-react';
import { btn, btnSize, cn, field, label, panel, sectionTitle } from './ui/styles';

type Phase = 'idle' | 'pending' | 'live' | 'ended' | 'invalid';

/** The admin's own zone — datetime-local has no zone, so name it explicitly. */
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function VotingTimerAdmin() {
  const configRef = doc(db, 'config', 'votingConfig');

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
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
      if (!start || !end) { setPhase('idle'); setCountdown(''); return; }
      const now = Date.now();
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      if (Number.isNaN(s) || Number.isNaN(e)) {
        setPhase('invalid');
        setCountdown(''); return;
      }
      if (now < s) { setPhase('pending'); setCountdown(fmt(e - now)); }
      else if (now > e) { setPhase('ended'); setCountdown(''); }
      else { setPhase('live'); setCountdown(fmt(e - now)); }
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

  const handleSave = async () => {
    if (!start || !end) {
      toast.error('Pick both a start and an end time');
      return;
    }
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      toast.error('Those dates are not valid');
      return;
    }
    if (endMs <= startMs) {
      toast.error('The end time has to be after the start time');
      return;
    }
    try {
      // startMs/endMs are what firestore.rules checks — rules cannot parse a
      // datetime-local string. The ISO strings stay for the inputs to read back.
      // Changing endMs also makes the Cloud Function re-decide the winner,
      // which replaces the old "clear the stale winner on extend" transaction.
      await setDoc(configRef, { start, end, startMs, endMs, zone: LOCAL_ZONE });
      toast.success('Voting window saved');
    } catch (err) {
      console.error(err);
      toast.error("Couldn't save the voting window");
    }
  };

  const statusText: Record<Phase, string> = {
    idle: 'No window set',
    pending: 'Scheduled — not open yet',
    live: 'Voting is open',
    ended: 'Voting has ended',
    invalid: 'Those dates are not valid',
  };

  return (
    <section className={cn(panel, 'flex flex-col p-5 sm:p-6')}>
      <div className="mb-4 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-field bg-brand-50 text-brand-700"
        >
          <Clock size={16} strokeWidth={2.25} />
        </span>
        <h2 className={sectionTitle}>Voting window</h2>
      </div>

      <p className="mb-3 text-sm text-ink-subtle">
        Times are in <b className="font-semibold text-ink">{LOCAL_ZONE}</b> — your computer&apos;s
        zone, not the office&apos;s.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="vote-start" className={label}>Opens</label>
          <input
            id="vote-start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={cn(field, 'mt-1.5')}
          />
        </div>
        <div>
          <label htmlFor="vote-end" className={label}>Closes</label>
          <input
            id="vote-end"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={cn(field, 'mt-1.5')}
          />
        </div>
      </div>

      <div
        className={cn(
          'mt-4 flex items-center justify-between gap-3 rounded-field px-3.5 py-2.5',
          phase === 'live'
            ? 'bg-brand-50 text-brand-800'
            : phase === 'invalid'
              ? 'bg-danger-50 text-danger-700'
              : 'bg-surface-muted text-ink-muted'
        )}
        aria-live="polite"
      >
        <span className="text-sm font-medium">{statusText[phase]}</span>
        {countdown && (
          <time data-numeric className="font-display text-lg font-bold tracking-tight">
            {countdown}
          </time>
        )}
      </div>

      <button onClick={handleSave} className={cn(btn.primary, btnSize.lg, 'mt-4')}>
        <Save size={16} strokeWidth={2.25} aria-hidden="true" />
        Save window
      </button>
    </section>
  );
}
