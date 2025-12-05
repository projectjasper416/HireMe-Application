import { Router } from 'express';
import { supabaseAdmin, supabaseClient } from '../config/supabase';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import type { UserRole } from '../types/roles';
import { Logger } from '../utils/Logger';

export const authRouter = Router();

// PRD 4 Target Audience: smooth onboarding with email and social providers
// TDD 4.1 Authentication Endpoints: email/password sign-up
authRouter.post('/signup', async (req, res) => {
  const transactionId = `signup-${Date.now()}`;
  try {
    const { email, password, metadata } = req.body as { email: string; password: string; metadata?: Record<string, unknown> };
    if (!email || !password) {
      
      return res.status(400).json({ error: 'email and password required' });
    }


    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: metadata || {},
        emailRedirectTo: req.headers.origin ? `${req.headers.origin}/auth/callback` : undefined,
      },
    });

    if (error) {
      await Logger.logBackendError('Auth', error, {
        TransactionID: transactionId,
        Endpoint: 'POST /auth/signup',
        RequestPayload: { email: '***' }
      });
      return res.status(400).json({ error: error.message });
    }

    await Logger.logInfo('Auth', 'User signup successful', {
      TransactionID: transactionId,
      Endpoint: 'POST /auth/signup',
      UserID: data.user?.id,
      Status: 'SUCCESS'
    });

    return res.status(201).json({ user: data.user });
  } catch (error) {
    await Logger.logBackendError('Auth', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /auth/signup',
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// TDD 4.1 Authentication Endpoints: email/password login
authRouter.post('/login', async (req, res) => {
  const transactionId = `login-${Date.now()}`;
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      
      return res.status(400).json({ error: 'email and password required' });
    }


    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      await Logger.logBackendError('Auth', error, {
        TransactionID: transactionId,
        Endpoint: 'POST /auth/login',
        Status: 'AUTH_FAILED',
        RequestPayload: { email: '***' }
      });
      return res.status(401).json({ error: error.message });
    }

    await Logger.logInfo('Auth', 'User login successful', {
      TransactionID: transactionId,
      Endpoint: 'POST /auth/login',
      UserID: data.user?.id,
      Status: 'SUCCESS'
    });

    // TDD 3.1 Users: Surface session access token for client storage
    return res.json({
      user: data.user,
      accessToken: data.session?.access_token,
      refreshToken: data.session?.refresh_token,
    });
  } catch (error) {
    await Logger.logBackendError('Auth', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /auth/login',
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// TDD 4.1: Social login (frontend should initiate; backend can provide provider URL)
authRouter.get('/oauth/url', async (req, res) => {
  const transactionId = `oauth-url-${Date.now()}`;
  try {
    const provider = String(req.query.provider || '').toLowerCase();
    if (!provider || !['google', 'apple'].includes(provider)) {
      await Logger.logBackendError('Auth', new Error('provider must be google or apple'), {
        TransactionID: transactionId,
        Endpoint: 'GET /auth/oauth/url',
        Status: 'VALIDATION_ERROR',
        RequestPayload: { provider }
      });
      return res.status(400).json({ error: 'provider must be google or apple' });
    }
    const redirectTo = (req.query.redirectTo as string) || (req.headers.origin ? `${req.headers.origin}/auth/callback` : undefined);
    
    await Logger.logInfo('Auth', 'OAuth URL requested', {
      TransactionID: transactionId,
      Endpoint: 'GET /auth/oauth/url',
      RequestPayload: { provider }
    });

    return res.json({ provider, redirectTo });
  } catch (error) {
    await Logger.logBackendError('Auth', error, {
      TransactionID: transactionId,
      Endpoint: 'GET /auth/oauth/url',
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Example of an authenticated endpoint with role-based access
authRouter.get('/me', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const transactionId = `me-${Date.now()}`;
  try {
    
    return res.json({ user: req.user });
  } catch (error) {
    await Logger.logBackendError('Auth', error, {
      TransactionID: transactionId,
      Endpoint: 'GET /auth/me',
      UserID: req.user?.id,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin-only example
authRouter.get('/admin/ping', requireAuth(['admin' as UserRole]), async (req: AuthenticatedRequest, res) => {
  const transactionId = `admin-ping-${Date.now()}`;
  try {
    await Logger.logInfo('Auth', 'Admin ping', {
      TransactionID: transactionId,
      Endpoint: 'GET /auth/admin/ping',
      UserID: req.user?.id
    });
    return res.json({ ok: true });
  } catch (error) {
    await Logger.logBackendError('Auth', error, {
      TransactionID: transactionId,
      Endpoint: 'GET /auth/admin/ping',
      UserID: req.user?.id,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// TDD 8 Security & Compliance: Admin utility to set a role on a user (service key required)
authRouter.post('/admin/set-role', requireAuth(['admin' as UserRole]), async (req: AuthenticatedRequest, res) => {
  const transactionId = `set-role-${Date.now()}`;
  try {
    const { userId, role } = req.body as { userId: string; role: UserRole };
    if (!userId || !role) {
      await Logger.logBackendError('Auth', new Error('userId and role required'), {
        TransactionID: transactionId,
        Endpoint: 'POST /auth/admin/set-role',
        Status: 'VALIDATION_ERROR',
        UserID: req.user?.id
      });
      return res.status(400).json({ error: 'userId and role required' });
    }

    await Logger.logInfo('Auth', 'Admin setting user role', {
      TransactionID: transactionId,
      Endpoint: 'POST /auth/admin/set-role',
      UserID: req.user?.id,
      RequestPayload: { targetUserId: userId, role }
    });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { role },
      app_metadata: { role },
    });

    if (error) {
      await Logger.logBackendError('Auth', error, {
        TransactionID: transactionId,
        Endpoint: 'POST /auth/admin/set-role',
        UserID: req.user?.id,
        RequestPayload: { targetUserId: userId, role }
      });
      return res.status(400).json({ error: error.message });
    }

    await Logger.logInfo('Auth', 'User role updated successfully', {
      TransactionID: transactionId,
      Endpoint: 'POST /auth/admin/set-role',
      UserID: req.user?.id,
      Status: 'SUCCESS',
      RelatedTo: userId
    });

    return res.json({ ok: true });
  } catch (error) {
    await Logger.logBackendError('Auth', error, {
      TransactionID: transactionId,
      Endpoint: 'POST /auth/admin/set-role',
      UserID: req.user?.id,
      Status: 'INTERNAL_ERROR'
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});


