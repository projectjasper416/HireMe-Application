import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';

interface Props {
  apiBaseUrl: string;
  onAuthed: (session: { token: string; user?: any }) => void;
}

export function LoginForm({ apiBaseUrl, onAuthed }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Login failed');
      
      // Set the session in Supabase client so it persists across page refreshes
      if (json.accessToken && json.refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: json.accessToken,
          refresh_token: json.refreshToken,
        });
        
        if (sessionError) {
          console.error('Error setting session:', sessionError);
          // Still proceed with authentication even if session setting fails
        }
      }
      
      if (json.accessToken) {
        onAuthed({ token: json.accessToken, user: json.user });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <input
        type="email"
        placeholder="you@example.com"
        className="rounded-2xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/10"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="••••••••"
        className="rounded-2xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/10"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <div className="text-sm text-red-600">{error}</div>}
      <motion.button
        whileTap={{ scale: 0.98 }}
        disabled={loading}
        className="rounded-2xl bg-black px-4 py-3 text-white hover:bg-black/90 transition-all"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </motion.button>
    </form>
  );
}


