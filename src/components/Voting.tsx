// src/components/Voting.tsx
import { useEffect, useMemo, useState } from 'react';
import { getDoc, serverTimestamp, setDoc, onSnapshot, doc } from 'firebase/firestore';
import { db, auth, loginWithGoogle } from '../../firebaseConfig';
import toast from 'react-hot-toast';
import { Check, Lock } from 'lucide-react';
import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { voteDocId } from './utils/voteDocId';
import { btn, btnSize, cn, panel } from './ui/styles';

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v === 'number') return v;
  return 0;
}

/** Quiet status card — used for every non-ballot state so they share one shape. */
function StatusCard({
  icon,
  title,
  body,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  tone?: 'neutral' | 'affirm';
}) {
  return (
    <section
      className={cn(
        panel,
        'animate-rise flex items-center gap-3.5 p-5',
        tone === 'affirm' && 'border-brand-200 bg-brand-50'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'animate-pop flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg',
          tone === 'affirm' ? 'bg-brand-200 text-brand-900' : 'bg-surface-muted text-ink-subtle'
        )}
        style={{ animationDelay: '120ms' }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            'font-display font-bold tracking-tight',
            tone === 'affirm' ? 'text-brand-900' : 'text-ink'
          )}
        >
          {title}
        </p>
        {body && <p className="mt-0.5 text-sm text-ink-muted">{body}</p>}
      </div>
    </section>
  );
}

export default function Voting({ user }: { user: any }) {
  const weekKey = useWeekKey();

  const [selected, setSelected] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [choices, setChoices] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [voteStart, setVoteStart] = useState(0);
  const [voteEnd, setVoteEnd] = useState(0);
  const [now, setNow] = useState(Date.now());

  const canVote = useMemo(() => now >= voteStart && now <= voteEnd, [now, voteStart, voteEnd]);

  // tick "now"
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // load options from weeklyOptions/{weekKey}
  useEffect(() => {
    if (!weekKey) return;
    setLoadingOptions(true);
    const unsub = onSnapshot(
      doc(db, 'weeklyOptions', weekKey),
      (snap) => {
        if (!snap.exists()) {
          setChoices([]);
          setLoadingOptions(false);
          return;
        }
        const data = snap.data() as any;
        setChoices(normalizeChoices(data?.choices));
        setLoadingOptions(false);
      },
      () => setLoadingOptions(false)
    );
    return () => unsub();
  }, [weekKey]);

  // clear selection if options changed
  useEffect(() => {
    if (selected && !choices.includes(selected)) setSelected('');
  }, [choices, selected]);

  // voting window
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'votingConfig'), (snap) => {
      if (!snap.exists()) {
        setVoteStart(0);
        setVoteEnd(0);
        return;
      }
      const data = snap.data();
      setVoteStart(toMillis(data?.startTime ?? data?.start));
      setVoteEnd(toMillis(data?.endTime ?? data?.end));
    });
    return () => unsub();
  }, []);

  // One vote per person per week is enforced by the document ID, both here and
  // in firestore.rules — so checking is a single point read, not a query.
  useEffect(() => {
    async function checkVote() {
      if (!user?.uid || !weekKey) return;
      const snap = await getDoc(doc(db, 'votes', voteDocId(weekKey, user.uid)));
      setHasVoted(snap.exists());
    }
    if (user && weekKey) checkVote();
  }, [user, weekKey]);

  // cast vote
  async function castVote() {
    if (!selected || isSubmitting) return;

    if (!auth.currentUser) {
      await loginWithGoogle();
      return;
    }

    if (!user?.email?.endsWith?.('@calvada.com')) {
      toast.error('Only @calvada.com accounts can vote');
      return;
    }

    setIsSubmitting(true);

    try {
      // Deterministic ID. A second vote targets an existing path, which the
      // rules treat as an update and deny — so two tabs can't both get through.
      await setDoc(doc(db, 'votes', voteDocId(weekKey, user.uid)), {
        userId: user.uid,
        userName: user.displayName,
        userEmail: user.email,
        choice: selected,
        week: weekKey,
        createdAt: serverTimestamp(),
      });

      toast.success(`Voted for ${selected} 🎉`);
      setHasVoted(true);
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        // Almost always the one-vote-per-week rule firing.
        toast.error('You have already voted this week');
        setHasVoted(true);
      } else {
        toast.error("Couldn't submit your vote. Try again.");
      }
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  /** render — the countdown lives in the Leaderboard, which owns the timer. */
  if (!canVote) {
    return (
      <StatusCard
        icon={<Lock size={17} strokeWidth={2.25} />}
        title="Voting is closed"
        body={
          voteStart > now
            ? 'The ballot opens when the next voting window starts.'
            : 'Results are below.'
        }
      />
    );
  }

  if (loadingOptions) {
    return (
      <section className={cn(panel, 'space-y-3 p-5')} aria-busy="true" aria-label="Loading options">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-card bg-surface-muted" />
        ))}
      </section>
    );
  }

  if (!choices.length) {
    return (
      <StatusCard
        icon="🤷"
        title="No options yet"
        body="An admin still needs to set this week's choices."
      />
    );
  }

  if (hasVoted) {
    return (
      <StatusCard
        tone="affirm"
        icon="🙌"
        title="Your vote is in"
        body="You get one vote per week. Watch the results below."
      />
    );
  }

  return (
    <section className={cn(panel, 'animate-rise p-5 sm:p-6')}>
      <fieldset className="border-0 p-0">
        <legend className="mb-4 w-full">
          <span className="font-display text-xl font-bold tracking-tight">
            Choose this week&apos;s lunch <span aria-hidden="true">🍽️</span>
          </span>
          <span className="mt-1 block text-sm text-ink-muted">
            Pick one. You can&apos;t change it after you submit.
          </span>
        </legend>

        <div className="space-y-2.5">
          {choices.map((opt, idx) => {
            const isSelected = selected === opt;
            return (
              <label
                key={opt}
                className="animate-rise block cursor-pointer"
                style={{ animationDelay: `${100 + idx * 70}ms` }}
              >
                <input
                  type="radio"
                  name="lunch"
                  value={opt}
                  checked={isSelected}
                  onChange={() => setSelected(opt)}
                  className="peer sr-only"
                />
                {/* Whole card is the tap target — a 20px radio is a poor one on mobile. */}
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-card border-2 px-4 py-3.5',
                    'transition-[background-color,border-color,transform,box-shadow] duration-200',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600',
                    isSelected
                      ? 'border-brand-600 bg-brand-50 shadow-card'
                      : 'border-border bg-surface hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-muted hover:shadow-card'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      isSelected
                        ? 'border-brand-600 bg-brand-600 text-on-brand'
                        : 'border-border-strong bg-surface'
                    )}
                  >
                    {isSelected && <Check className="animate-pop" size={12} strokeWidth={3.5} />}
                  </span>
                  <span
                    className={cn(
                      'text-base font-semibold',
                      isSelected ? 'text-brand-900' : 'text-ink'
                    )}
                  >
                    {opt}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <button
        onClick={castVote}
        disabled={!selected || isSubmitting}
        className={cn(btn.primary, btnSize.lg, 'mt-5')}
      >
        {isSubmitting ? 'Submitting…' : 'Submit vote'}
      </button>
    </section>
  );
}
