import { Router } from 'express';
import { supabaseAdmin, supabaseClient } from '../config/supabase';
import { requireAuth } from '../middleware/auth';
import type { UserRole } from '../types/roles';

export const authRouter = Router();

// PRD 4 Target Audience: smooth onboarding with email and social providers
// TDD 4.1 Authentication Endpoints: email/password sign-up
authRouter.post('/signup', async (req, res) => {
  const { email, password, metadata } = req.body as { email: string; password: string; metadata?: Record<string, unknown> };
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: metadata || {},
      emailRedirectTo: req.headers.origin ? `${req.headers.origin}/auth/callback` : undefined,
    },
  });

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({ user: data.user });
});

// TDD 4.1 Authentication Endpoints: email/password login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  // TDD 3.1 Users: Surface session access token for client storage
  return res.json({
    user: data.user,
    accessToken: data.session?.access_token,
    refreshToken: data.session?.refresh_token,
  });
});

// TDD 4.1: Social login (frontend should initiate; backend can provide provider URL)
authRouter.get('/oauth/url', (req, res) => {
  const provider = String(req.query.provider || '').toLowerCase();
  if (!provider || !['google', 'apple'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be google or apple' });
  }
  const redirectTo = (req.query.redirectTo as string) || (req.headers.origin ? `${req.headers.origin}/auth/callback` : undefined);
  return res.json({ provider, redirectTo });
});

// Example of an authenticated endpoint with role-based access
authRouter.get('/me', requireAuth(), async (req, res) => {
  return res.json({ user: req.user });
});

// Admin-only example
authRouter.get('/admin/ping', requireAuth(['admin' as UserRole]), async (_req, res) => {
  return res.json({ ok: true });
});

// TDD 8 Security & Compliance: Admin utility to set a role on a user (service key required)
authRouter.post('/admin/set-role', requireAuth(['admin' as UserRole]), async (req, res) => {
  const { userId, role } = req.body as { userId: string; role: UserRole };
  if (!userId || !role) return res.status(400).json({ error: 'userId and role required' });

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { role },
    app_metadata: { role },
  });

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});


