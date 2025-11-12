import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LoginForm } from './components/LoginForm';
import { SignupForm } from './components/SignupForm';
import { SocialButtons } from './components/SocialButtons';
import { ResumeWorkspace } from './components/ResumeWorkspace';
import { AIReviewPage } from './pages/AIReviewPage';
import { supabase } from './lib/supabase';

export function App() {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [session, setSession] = useState<{ token: string; user?: any } | null>(null);
  const [profile, setProfile] = useState<any>(null);

  const apiBaseUrl = useMemo(() => import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000', []);
  const redirectTo = `${window.location.origin}/auth/callback`;

  function handleAuthed(nextSession: { token: string; user?: any }) {
    setSession(nextSession);
    setProfile(nextSession.user);
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
    supabase.auth.getSession().then(({ data }) => {
      const accessToken = data.session?.access_token;
      if (accessToken) {
        handleAuthed({ token: accessToken, user: data.session?.user });
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      const accessToken = currentSession?.access_token;
      if (accessToken) {
        handleAuthed({ token: accessToken, user: currentSession?.user });
      } else {
        setSession(null);
        setProfile(null);
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

  if (session?.token) {
    return (
      <Router>
        <div className="min-h-full bg-gradient-to-b from-white to-gray-50">
          <div className="mx-auto max-w-6xl px-6 py-10">
            <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-4xl font-bold">Welcome back</h1>
                <p className="text-base text-gray-600">
                  {profile?.email || 'Authenticated'} · Role: {profile?.role || 'user'}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="self-start rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-all hover:border-black/40"
              >
                Logout
              </button>
            </div>

            <Routes>
              <Route path="/" element={<ResumeWorkspace apiBaseUrl={apiBaseUrl} token={session.token} />} />
              <Route path="/ai-review/:resumeId" element={<AIReviewPage apiBaseUrl={apiBaseUrl} token={session.token} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </Router>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-white to-gray-50">
      <div className="mx-auto max-w-md px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
        >
          <h1 className="mb-2 text-4xl font-bold tracking-tight">Welcome</h1>
          <p className="mb-6 text-base text-gray-600">Sign in or create your account</p>

          <div className="mb-6 flex gap-2 rounded-xl bg-gray-100 p-1">
            <button
              className={`flex-1 rounded-lg px-4 py-2 text-sm transition-all ${tab === 'login' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
              onClick={() => setTab('login')}
            >
              Login
            </button>
            <button
              className={`flex-1 rounded-lg px-4 py-2 text-sm transition-all ${tab === 'signup' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
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
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-sm text-gray-500">or</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <SocialButtons redirectTo={redirectTo} />
        </motion.div>
      </div>
    </div>
  );
}


