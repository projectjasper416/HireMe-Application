import type { NextFunction, Request, Response } from 'express';
import { DEFAULT_ROLE, type UserRole } from '../types/roles';
import { supabaseClient } from '../config/supabase';
import { Logger } from '../utils/Logger';
import { v4 as uuid } from 'uuid';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role: UserRole;
    raw: Record<string, unknown>;
  };
}

// TDD 8 Security & Compliance: Verify JWT against Supabase JWKS; enforce least privilege
export const requireAuth = (allowedRoles?: UserRole[]) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const transactionId = `auth-${uuid()}`;
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (!token) {
        await Logger.logBackendError('Auth', new Error('Missing bearer token'), {
          TransactionID: transactionId,
          Endpoint: req.path || 'Unknown',
          Status: 'AUTH_ERROR',
          Exception: 'Missing bearer token'
        });
        return res.status(401).json({ error: 'Missing bearer token' });
      }

      const { data, error } = await supabaseClient.auth.getUser(token);
      if (error || !data?.user) {
        await Logger.logBackendError('Auth', error || new Error('Invalid or expired token'), {
          TransactionID: transactionId,
          Endpoint: req.path || 'Unknown',
          Status: 'AUTH_ERROR',
          Exception: 'Invalid or expired token'
        });
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const user = data.user;
      const sub = String(user.id);
      const email = user.email ?? undefined;
      const role =
        (user.user_metadata && (user.user_metadata as any).role) ||
        (user.app_metadata && (user.app_metadata as any).role) ||
        DEFAULT_ROLE;

      const normalizedRole = String(role) as UserRole;

      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(normalizedRole)) {
        await Logger.logBackendError('Auth', new Error('Forbidden - insufficient role'), {
          TransactionID: transactionId,
          Endpoint: req.path || 'Unknown',
          UserID: sub,
          Status: 'FORBIDDEN',
          Exception: `User role ${normalizedRole} not in allowed roles: ${allowedRoles.join(', ')}`
        });
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = { id: sub, email, role: normalizedRole, raw: user as any };
      
      await Logger.logInfo('Auth', 'Authentication successful', {
        TransactionID: transactionId,
        Endpoint: req.path || 'Unknown',
        UserID: sub,
        Status: 'SUCCESS'
      });

      next();
    } catch (err) {
      await Logger.logBackendError('Auth', err, {
        TransactionID: transactionId,
        Endpoint: req.path || 'Unknown',
        Status: 'AUTH_ERROR',
        Exception: 'Unexpected authentication error'
      });
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
};


