// src/components/AdminDashboard.tsx
import { useEffect, useState } from 'react';
import {
  collection,
  collectionGroup,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';

import VotingTimerAdmin from './VotingTimerAdmin';
import MenuAdmin from './MenuAdmin';
import AdminWeekControl from './AdminWeekControl';

import { useWeekKey } from './utils/useWeekKey';
import { normalizeChoices } from './utils/normalizeChoices';
import { subscribeWeeklyOptions } from './utils/subscribeWeeklyOptions';
import { currentIsoWeekKey } from './utils/isoWeek';
import { useConfirm } from './ui/ConfirmDialog';
import { btn, btnSize, cn, field, panel, sectionTitle } from './ui/styles';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirm();

  // admins
  const [admins, setAdmins] = useState<{ email: string }[]>([]);
  const [newAdmin, setNewAdmin] = useState('');
  const [loadingAdmins, setLoadingAdmins] = useState(true);

  // weekly options
  const weekKey = useWeekKey();
  const todaysWeek = currentIsoWeekKey();
  const [weeklyChoices, setWeeklyChoices] = useState<string[]>([]);
  const [hasVotes, setHasVotes] = useState(false);

  // ===== Admin list =====
  useEffect(() => {
    async function loadAdmins() {
      const snapshot = await getDocs(collection(db, 'admins'));
      setAdmins(snapshot.docs.map((d) => ({ email: d.id })));
      setLoadingAdmins(false);
    }
    loadAdmins();
  }, []);

  // ===== Weekly options (resilient) + hasVotes for current week =====
  useEffect(() => {
    if (!weekKey) {
      setWeeklyChoices([]);
      setHasVotes(false);
      return;
    }

    const unsubOptions = subscribeWeeklyOptions(weekKey, (data) => {
      if (!data) {
        setWeeklyChoices([]);
        return;
      }
      setWeeklyChoices(normalizeChoices(data.choices));
    });

    const qVotes = query(collectionGroup(db, 'votes'), where('week', '==', weekKey));
    const unsubVotes = onSnapshot(
      qVotes,
      (snap) => setHasVotes(!snap.empty),
      (err) => {
        console.warn('[AdminDashboard] votes collectionGroup failed, falling back:', err?.message);
        const qTop = query(collection(db, 'votes'), where('week', '==', weekKey));
        const unsubTop = onSnapshot(qTop, (snapTop) => setHasVotes(!snapTop.empty));
        return () => unsubTop();
      }
    );

    return () => {
      unsubOptions?.();
      unsubVotes?.();
    };
  }, [weekKey]);

  // ===== Admin actions =====
  const addAdmin = async () => {
    // Lowercase on write: firestore.rules looks the caller up by their
    // lowercased Google address, so a mixed-case doc ID would never match.
    const email = newAdmin.trim().toLowerCase();
    if (!email) return;
    try {
      await setDoc(doc(db, 'admins', email), {});
      setAdmins((prev) => [...prev, { email }]);
      setNewAdmin('');
      toast.success('Admin added');
    } catch (err) {
      toast.error("Couldn't add that admin");
      console.error(err);
    }
  };

  const removeAdmin = async (email: string) => {
    const ok = await confirm({
      title: `Remove ${email}?`,
      body: 'They lose access to this dashboard immediately.',
      confirmLabel: 'Remove admin',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'admins', email));
      setAdmins((prev) => prev.filter((a) => a.email !== email));
      toast.success('Admin removed');
    } catch (err) {
      toast.error("Couldn't remove that admin");
      console.error(err);
    }
  };

  const handleResetWeekVotes = async () => {
    if (!weekKey) {
      toast.error('Set the current week first');
      return;
    }
    const ok = await confirm({
      title: `Delete this week's votes?`,
      body: `Clears every vote in ${weekKey}. Other weeks are untouched. This cannot be undone.`,
      confirmLabel: 'Delete week',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const votesSnap = await getDocs(
        query(collection(db, 'votes'), where('week', '==', weekKey))
      );
      await Promise.all(votesSnap.docs.map((vote) => deleteDoc(doc(db, 'votes', vote.id))));
      toast.success(`Votes cleared for ${weekKey}`);
    } catch (err) {
      toast.error("Couldn't clear this week's votes");
      console.error(err);
    }
  };

  const handleResetVotes = async () => {
    const ok = await confirm({
      title: 'Delete every vote?',
      body: 'This wipes all votes for all weeks, not just the current one. It cannot be undone.',
      confirmLabel: 'Delete all votes',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const votesSnap = await getDocs(collection(db, 'votes'));
      const deleteOps = votesSnap.docs.map((vote) => deleteDoc(doc(db, 'votes', vote.id)));
      await Promise.all(deleteOps);
      toast.success('All votes deleted');
    } catch (err) {
      toast.error("Couldn't reset votes");
      console.error(err);
    }
  };

  const regenerateWeeklyOptions = async () => {
    if (!weekKey) {
      toast.error('Set the current week first, e.g. 2025-W43');
      return;
    }
    try {
      const snapshot = await getDocs(collection(db, 'menu'));
      const allOptions = snapshot.docs
        .map((d) => (d.data().name ?? '').toString().trim())
        .filter(Boolean);

      if (allOptions.length < 4) {
        toast.error('Add at least 4 menu items first');
        return;
      }

      const shuffled = [...allOptions].sort(() => 0.5 - Math.random()).slice(0, 4);
      await setDoc(
        doc(db, 'weeklyOptions', weekKey),
        {
          choices: shuffled,
          week: weekKey,
          updatedAt: serverTimestamp(),
          // preserve existing winner if present – omit it on purpose here
        },
        { merge: true }
      );

      toast.success(`New options drawn for ${weekKey}`);
    } catch (err) {
      toast.error("Couldn't draw new options");
      console.error(err);
    }
  };

  const handleRemoveWeeklyOption = async (choice: string) => {
    if (!weekKey) {
      toast.error('Set the current week first');
      return;
    }
    const ok = await confirm({
      title: `Remove ${choice}?`,
      body: `It comes off this week's ballot. The menu item itself stays.`,
      confirmLabel: 'Remove option',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = weeklyChoices.filter((item) => item !== choice);
      await setDoc(
        doc(db, 'weeklyOptions', weekKey),
        {
          choices: updated,
          week: weekKey,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      toast.success('Option removed');
    } catch (err) {
      toast.error("Couldn't remove that option");
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {confirmDialog}

      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-field bg-ink text-ink-inverse"
            >
              <Shield size={16} strokeWidth={2.25} />
            </span>
            <h1 className="font-display text-lg font-extrabold tracking-tight">Admin</h1>
          </div>

          <nav className="flex items-center gap-1.5">
            <button onClick={() => navigate('/votes')} className={cn(btn.quiet, 'px-2.5 py-1.5')}>
              <Users size={15} strokeWidth={2.25} aria-hidden="true" />
              Votes
            </button>
            <button
              onClick={() => navigate('/admin/winners')}
              className={cn(btn.quiet, 'px-2.5 py-1.5')}
            >
              <Trophy size={15} strokeWidth={2.25} aria-hidden="true" />
              Winners
            </button>
            <button onClick={() => navigate('/')} className={cn(btn.secondary, btnSize.sm)}>
              <ArrowLeft size={15} strokeWidth={2.25} aria-hidden="true" />
              Back to app
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-8 sm:px-6">
        {/* The week key never rolls over on its own. Say so before someone
            spends ten minutes wondering why the ballot looks empty. */}
        {!weekKey ? (
          <p className="rounded-panel border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            <b className="font-semibold">No current week is set.</b> Everyone sees an empty ballot
            until you set one below — today&apos;s is <b data-numeric>{todaysWeek}</b>.
          </p>
        ) : weekKey !== todaysWeek ? (
          <p className="rounded-panel border border-warning-600/25 bg-warning-50 px-4 py-3 text-sm text-warning-800">
            The current week is <b data-numeric>{weekKey}</b>, but this week is{' '}
            <b data-numeric>{todaysWeek}</b>. Voting still runs against {weekKey} until you roll it
            over.
          </p>
        ) : null}

        {/* Setup pair — these two are always configured together. */}
        <div className="grid gap-5 lg:grid-cols-2">
          <AdminWeekControl />
          <VotingTimerAdmin />
        </div>

        {/* This week's ballot */}
        <section className={cn(panel, 'p-5 sm:p-6')}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={sectionTitle}>This week&apos;s ballot</h2>
            {weekKey && <span className="text-sm text-ink-subtle">{weekKey}</span>}
          </div>

          {!weekKey && (
            <p className="mb-4 rounded-field border border-warning-600/25 bg-warning-50 px-3.5 py-2.5 text-sm text-warning-800">
              Set the current week above before managing the ballot.
            </p>
          )}

          {weeklyChoices.length > 0 ? (
            <ol className="mb-4 space-y-2">
              {weeklyChoices.map((choice, index) => (
                <li
                  key={`${choice}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-muted px-4 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      data-numeric
                      aria-hidden="true"
                      className="text-sm font-semibold text-ink-subtle"
                    >
                      {index + 1}
                    </span>
                    <span className="truncate font-medium">{choice}</span>
                  </span>
                  <button
                    onClick={() => handleRemoveWeeklyOption(choice)}
                    className={btn.quietDanger}
                  >
                    <X size={14} strokeWidth={2.5} aria-hidden="true" />
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mb-4 rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-sm text-ink-subtle">
              <span aria-hidden="true" className="mr-1.5">🎲</span>
              No options drawn yet. Draw four at random from the menu below.
            </p>
          )}

          <button
            onClick={regenerateWeeklyOptions}
            disabled={hasVotes || !weekKey}
            className={cn(btn.primary, btnSize.lg)}
          >
            <RefreshCw size={16} strokeWidth={2.25} aria-hidden="true" />
            Draw new options
          </button>

          {hasVotes && (
            <p className="mt-2 text-center text-sm text-ink-subtle">
              Locked — voting has already started this week.
            </p>
          )}
        </section>

        <MenuAdmin />

        {/* Admins */}
        <section className={cn(panel, 'p-5 sm:p-6')}>
          <h2 className={cn(sectionTitle, 'mb-4')}>Admins</h2>

          <div className="mb-5 flex flex-col gap-2.5 sm:flex-row">
            <input
              type="email"
              value={newAdmin}
              onChange={(e) => setNewAdmin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addAdmin();
              }}
              placeholder="name@calvada.com"
              aria-label="New admin email"
              className={field}
            />
            <button onClick={addAdmin} className={cn(btn.primary, btnSize.md, 'shrink-0')}>
              <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
              Add admin
            </button>
          </div>

          {loadingAdmins ? (
            <p className="text-sm text-ink-subtle">Loading admins…</p>
          ) : (
            <ul className="space-y-2">
              {admins.map(({ email }) => (
                <li
                  key={email}
                  className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-muted px-4 py-2.5"
                >
                  <span className="truncate text-sm">{email}</span>
                  <button onClick={() => removeAdmin(email)} className={btn.quietDanger}>
                    <X size={14} strokeWidth={2.5} aria-hidden="true" />
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Danger zone */}
        <section className="rounded-panel border border-danger-200 bg-danger-50 p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold tracking-tight text-danger-900">
            Danger zone
          </h2>
          <p className="mt-1 mb-4 text-sm text-danger-700">
            Deleting votes is permanent. Start with the narrower option.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleResetWeekVotes}
              disabled={!weekKey}
              className={cn(btn.secondary, btnSize.md)}
            >
              <Trash2 size={16} strokeWidth={2.25} aria-hidden="true" />
              Clear {weekKey || 'this week'} only
            </button>
            <button onClick={handleResetVotes} className={cn(btn.danger, btnSize.md)}>
              <Trash2 size={16} strokeWidth={2.25} aria-hidden="true" />
              Delete all votes
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
