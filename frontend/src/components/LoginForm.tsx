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
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          Email Address
        </label>
        <input
          type="email"
          placeholder="Email Address"
          className="flex h-10 w-full rounded-md border border-gray-400 bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center">
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Password
          </label>
          <a
            href="#"
            className="ml-auto inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Forgot your password?
          </a>
        </div>
        <input
          type="password"
          placeholder="••••••••"
          className="flex h-10 w-full rounded-md border border-gray-400 bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          id="remember"
          className="h-4 w-4 rounded border-gray-400 text-primary focus:ring-primary"
        />
        <label
          htmlFor="remember"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Remember me
        </label>
      </div>
      {error && <div className="text-sm font-medium text-destructive">{error}</div>}
      <motion.button
        whileTap={{ scale: 0.98 }}
        disabled={loading}
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </motion.button>
    </form>
  );
}


