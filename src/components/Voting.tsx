// src/components/Voting.tsx
import { useEffect, useMemo, useState } from 'react';
import { getDoc, serverTimestamp, setDoc, onSnapshot, doc } from 'firebase/firestore';
import { db, auth, loginWithGoogle } from '../../firebaseConfig';
import toast from 'react-hot-toast';
import { Check, Lock } from 'lucide-react';
import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { voteDocId } from './utils/voteDocId';
import { btn, btnSize, cn, panel, ticketRule } from './ui/styles';

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
        'paper-tear animate-rise relative flex items-center gap-3.5 p-5 pt-6',
        tone === 'affirm' && 'border-brand-200 bg-brand-50'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'animate-pop flex h-9 w-9 shrink-0 items-center justify-center text-lg',
          // Matches the header lockup — a green square is the app's mark, so the
          // confirmation reads as Calvada rather than as a stray mint chip.
          tone === 'affirm' ? 'bg-brand-500 text-on-brand' : 'bg-surface-muted text-ink-subtle'
        )}
        style={{ animationDelay: '120ms' }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className={cn('ticket-title text-lg', tone === 'affirm' ? 'text-brand-900' : 'text-ink')}>
          {title}
        </p>
        {body && <p className="mt-1 text-sm text-ink-muted">{body}</p>}
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
    <section className={cn(panel, 'paper-tear animate-rise relative p-5 pt-7 sm:p-6 sm:pt-8')}>
      {/* Ticket header. The week key is an internal identifier, but on an order
          pad the order number is exactly the sort of thing that gets printed at
          the top — so it earns its place here rather than reading as debug. */}
      <div className={cn(ticketRule, 'ticket-meta flex items-baseline justify-between pb-2 text-[0.625rem] text-ink-muted')}>
        <span>ORDER {weekKey || '—'}</span>
        <span>NOT SENT</span>
      </div>

      <fieldset className="mt-4 border-0 p-0">
        <legend className="mb-4 w-full">
          <span className="ticket-title block text-2xl">
            Today&apos;s
            <br />
            order
          </span>
          <span className="mt-1.5 block text-sm text-ink-muted">
            One pick each. You can&apos;t change it after you send it.
          </span>
        </legend>

        <div className="flex flex-col">
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
                {/* Whole line is the tap target — a 20px radio is a poor one on
                    mobile. Lines sit flush like printed menu rows rather than
                    floating as cards, so the ticket reads as one sheet. */}
                <div
                  className={cn(
                    'flex items-center gap-3 px-2 py-3',
                    'transition-colors duration-150',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stamp-600',
                    isSelected ? 'bg-stamp-50' : 'hover:bg-surface-muted'
                  )}
                >
                  {/* Square, because you tick a box on a paper order — and the
                      tick is stamp red, never green. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 transition-colors',
                      isSelected ? 'border-stamp-600 bg-stamp-600 text-on-stamp' : 'border-ink'
                    )}
                  >
                    {isSelected && <Check className="animate-pop" size={12} strokeWidth={3.5} />}
                  </span>
                  <span
                    className={cn(
                      'text-base',
                      isSelected ? 'font-semibold text-stamp-700' : 'text-ink'
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
        className={cn(btn.primary, btnSize.lg, 'mt-6')}
      >
        {isSubmitting ? 'Sending…' : 'Send my order'}
      </button>
    </section>
  );
}
