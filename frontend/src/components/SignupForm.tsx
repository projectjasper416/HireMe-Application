import { useState } from 'react';
import { motion } from 'framer-motion';

interface Props {
  apiBaseUrl: string;
}

export function SignupForm({ apiBaseUrl }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${apiBaseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Signup failed');
      setMessage('Check your email to confirm your account.');
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
        placeholder="Create a password"
        className="rounded-2xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/10"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <div className="text-sm text-red-600">{error}</div>}
      {message && <div className="text-sm text-green-600">{message}</div>}
      <motion.button
        whileTap={{ scale: 0.98 }}
        disabled={loading}
        className="rounded-2xl bg-black px-4 py-3 text-white hover:bg-black/90 transition-all"
      >
        {loading ? 'Creating…' : 'Create account'}
      </motion.button>
    </form>
  );
}


