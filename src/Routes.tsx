import { Suspense, lazy, useEffect, useState } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import ErrorBoundary from './components/ui/ErrorBoundary';

// Admin screens are lazy: most people who load this app cast one vote and
// leave. There is no reason to ship them the dashboard, the tables and the
// CSV export on the critical path.
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const AdminVotersPage = lazy(() => import('./components/AdminVotersPage'));
const AdminWinnersPage = lazy(() => import('./components/AdminWinnersPage'));

/** Every screen gets its own tab title instead of one shared app name. */
function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  useDocumentTitle(title);
  return <>{children}</>;
}

function RouteFallback() {
  return <div className="grid min-h-screen place-items-center text-sm text-ink-subtle">Loading…</div>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const [user, loading] = useAuthState(auth);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    async function checkAdmin() {
      if (!user) return;
      try {
        // Lowercased to match the document IDs firestore.rules looks up.
        const ref = doc(db, 'admins', user.email!.toLowerCase());
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
    return (
      <div className="grid min-h-screen place-items-center text-sm text-ink-subtle">
        Checking access…
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function AppRoutes() {
  return (
    <ErrorBoundary>
      {/* One Toaster for the whole app — mounting it per-component duplicated toasts. */}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3500,
          style: {
            background: 'var(--color-ink)',
            color: 'var(--color-canvas)',
            borderRadius: 'var(--radius-field)',
            fontSize: '0.875rem',
            fontWeight: 500,
            padding: '0.625rem 0.875rem',
          },
          success: { iconTheme: { primary: 'var(--color-brand-500)', secondary: '#fff' } },
          error: { iconTheme: { primary: 'var(--color-danger-500)', secondary: '#fff' } },
        }}
      />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            path="/"
            element={
              <Screen title="Calvada Lunch Vote">
                <App />
              </Screen>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Screen title="Admin · Calvada Lunch Vote">
                  <AdminDashboard />
                </Screen>
              </AdminRoute>
            }
          />
          <Route
            path="/votes"
            element={
              <AdminRoute>
                <Screen title="Who voted · Calvada Lunch Vote">
                  <AdminVotersPage />
                </Screen>
              </AdminRoute>
            }
          />
          <Route
            path="/admin/winners"
            element={
              <AdminRoute>
                <Screen title="Past winners · Calvada Lunch Vote">
                  <AdminWinnersPage />
                </Screen>
              </AdminRoute>
            }
          />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
