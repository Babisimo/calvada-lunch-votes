import { useEffect, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, loginWithGoogle, logout, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';

import Login from './components/Login';
import Voting from './components/Voting';
import Leaderboard from './components/Leaderboard';

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
        const ref = doc(db, 'admins', user.email!);
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
      <div className="min-h-screen grid place-items-center text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <header className="flex items-center justify-between mb-10">
          <h1 className="text-3xl font-bold tracking-tight">🍽️ Weekly Lunch Vote</h1>
          {isAdmin && (
            <a
              href="/admin"
              className="text-sm font-medium text-purple-600 hover:underline transition ml-4"
            >
              Admin
            </a>
          )}
          {user && (
            <button
              onClick={logout}
              className="text-sm font-medium text-blue-600 hover:underline transition"
            >
              Logout
            </button>
          )}
        </header>

        {!user && <Login onLogin={loginWithGoogle} />}
        {user && <Voting user={user} />}

        <Leaderboard />
      </div>
    </div>
  );
}

export default App;
