import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LoginForm } from './components/LoginForm';
import { SignupForm } from './components/SignupForm';
import { SocialButtons } from './components/SocialButtons';
import { AppHeader } from './components/AppHeader';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ResumeWorkspace } from './components/ResumeWorkspace';
import { AIReviewPage } from './pages/AIReviewPage';
import { AITailorPage } from './pages/AITailorPage';
import { JobTrackerPage } from './pages/JobTrackerPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { supabase } from './lib/supabase';

export function App() {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [session, setSession] = useState<{ token: string; user?: any } | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const apiBaseUrl = useMemo(() => import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000', []);
  const redirectTo = `${window.location.origin}/auth/callback`;

  function handleAuthed(nextSession: { token: string; user?: any }) {
    setSession(nextSession);
    setProfile(nextSession.user);
    setLoading(false);
  }

  async function fetchProfile(accessToken: string) {
    try {
      const res = await fetch(`${apiBaseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const json = await res.json();
        setProfile(json.user);
      }
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    // Check for existing session on mount
    const initializeSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error('Error getting session:', error);
          setLoading(false);
          return;
        }

        const accessToken = data.session?.access_token;
        if (accessToken) {
          handleAuthed({ token: accessToken, user: data.session?.user });
          // Fetch full profile
          await fetchProfile(accessToken);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error('Session initialization error:', err);
        setLoading(false);
      }
    };

    initializeSession();

    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      console.log('Auth state changed:', event, currentSession ? 'has session' : 'no session');

      const accessToken = currentSession?.access_token;
      if (accessToken) {
        handleAuthed({ token: accessToken, user: currentSession?.user });
        // Fetch full profile when session is restored or refreshed
        await fetchProfile(accessToken);
      } else {
        // Only clear session on explicit sign out, not on token refresh or initial load
        if (event === 'SIGNED_OUT') {
          setSession(null);
          setProfile(null);
        }
        // For INITIAL_SESSION with no session, just stop loading
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
          setLoading(false);
        }
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session?.token) {
      fetchProfile(session.token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  // Show loading state while checking session
  if (loading) {
    return (
      <div className="min-h-full bg-gradient-to-b from-white to-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-gray-300 border-r-gray-900"></div>
          <p className="mt-4 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (session?.token) {
    return (
      <Router>
        <div className="min-h-full bg-background">
          <div className="mx-auto max-w-6xl px-6 py-10">
            <AppHeader profile={profile} onLogout={handleLogout} />

            <Routes>
              <Route path="/" element={<ResumeWorkspace apiBaseUrl={apiBaseUrl} token={session.token} />} />
              <Route path="/ai-review/:resumeId" element={<AIReviewPage apiBaseUrl={apiBaseUrl} token={session.token} />} />
              <Route path="/ai-tailor/:resumeId" element={<AITailorPage apiBaseUrl={apiBaseUrl} token={session.token} />} />
              <Route path="/job-tracker" element={<JobTrackerPage apiBaseUrl={apiBaseUrl} token={session.token} />} />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requiredRole="admin" userRole={profile?.role}>
                    <AdminDashboardPage apiBaseUrl={apiBaseUrl} token={session.token} />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </Router>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-md px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm"
        >
          <h1 className="mb-2 text-4xl font-bold tracking-tight">Welcome</h1>
          <p className="mb-6 text-base text-muted-foreground">Sign in or create your account</p>

          <div className="mb-6 flex gap-2 rounded-lg bg-muted p-1">
            <button
              className={`flex-1 rounded-md px-4 py-2 text-sm transition-all ${tab === 'login' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setTab('login')}
            >
              Login
            </button>
            <button
              className={`flex-1 rounded-md px-4 py-2 text-sm transition-all ${tab === 'signup' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setTab('signup')}
            >
              Sign up
            </button>
          </div>

          {tab === 'login' ? (
            <LoginForm apiBaseUrl={apiBaseUrl} onAuthed={handleAuthed} />
          ) : (
            <SignupForm apiBaseUrl={apiBaseUrl} />
          )}

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-sm text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <SocialButtons redirectTo={redirectTo} />
        </motion.div>
      </div>
    </div>
  );
}


