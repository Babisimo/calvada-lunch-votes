import { useEffect, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, loginWithGoogle, logout, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { LogOut, Shield, UtensilsCrossed } from 'lucide-react';

import Login from './components/Login';
import Voting from './components/Voting';
import Leaderboard from './components/Leaderboard';
import { btn, btnSize, cn } from './components/ui/styles';
import ThemeToggle from './components/ui/ThemeToggle';

function App() {
  const [user, loading] = useAuthState(auth);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);

  useEffect(() => {
    async function checkAdmin() {
      if (!user) {
        setIsAdmin(false);
        setAdminChecked(true);
        return;
      }

      try {
        // Lowercased to match the document IDs firestore.rules looks up.
        const ref = doc(db, 'admins', user.email!.toLowerCase());
        const snap = await getDoc(ref);
        setIsAdmin(snap.exists());
      } catch (err) {
        console.error('Error checking admin status:', err);
        setIsAdmin(false);
      } finally {
        setAdminChecked(true);
      }
    }

    checkAdmin();
  }, [user]);

  if (loading || !adminChecked) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-ink-subtle">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* The header is the counter, not a ticket — it stays on the kraft ground
          so the sheets in <main> are the only thing made of paper. */}
      <header className="border-b border-border-strong">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
          {/* Wordmark lockup — replace the mark + eyebrow with the real Calvada
              asset. This green square and the confirm button are the only two
              places green appears; results are stamp red. */}
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center bg-brand-500 text-on-brand"
            >
              <UtensilsCrossed size={18} strokeWidth={2.25} />
            </span>
            <span className="leading-tight">
              <span className="ticket-mark block text-[0.625rem] text-brand-600">Calvada</span>
              <span className="ticket-title mt-0.5 block text-xl">Lunch Vote</span>
            </span>
          </div>

          {/* Actions stay grouped — justify-between with 3 loose children pushed
              the admin link into the middle of the bar. */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {isAdmin && (
              <a href="/admin" className={cn(btn.secondary, btnSize.sm)}>
                <Shield size={15} strokeWidth={2.25} aria-hidden="true" />
                Admin
              </a>
            )}
            {user && (
              <button onClick={logout} className={cn(btn.quiet, 'px-2.5 py-1.5')}>
                <LogOut size={15} strokeWidth={2.25} aria-hidden="true" />
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-5 py-8 sm:px-6 sm:py-10">
        {!user && <Login onLogin={loginWithGoogle} />}
        {user && <Voting user={user} />}
        <Leaderboard />
      </main>
    </div>
  );
}

export default App;
