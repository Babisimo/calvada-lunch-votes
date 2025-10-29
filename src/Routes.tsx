import { Route, Routes, Navigate } from 'react-router-dom';
import App from './App';
import AdminDashboard from './components/AdminDashboard';
import AdminVotersPage from './components/AdminVotersPage';      // ← no .tsx
import AdminWinnersPage from './components/AdminWinnersPage';    // ← NEW
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

function AdminRoute({ children }: { children: React.ReactNode }) {
  const [user, loading] = useAuthState(auth);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    async function checkAdmin() {
      if (!user) return;
      try {
        const ref = doc(db, 'admins', user.email!);
        const snap = await getDoc(ref);
        setIsAdmin(snap.exists());
      } catch (err) {
        console.error('Failed to check admin:', err);
      } finally {
        setChecked(true);
      }
    }

    if (!loading && user) {
      checkAdmin();
    }
  }, [user, loading]);

  if (loading || (user && !checked)) {
    return <div className="text-center mt-20 text-gray-500">Checking access...</div>;
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/votes"
        element={
          <AdminRoute>
            <AdminVotersPage />
          </AdminRoute>
        }
      />
      {/* NEW: Admin → Previous Winners */}
      <Route
        path="/admin/winners"
        element={
          <AdminRoute>
            <AdminWinnersPage />
          </AdminRoute>
        }
      />
    </Routes>
  );
}
