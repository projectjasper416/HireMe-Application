import type { NextFunction, Request, Response } from 'express';
import { DEFAULT_ROLE, type UserRole } from '../types/roles';
import { supabaseClient } from '../config/supabase';

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
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (!token) {
        return res.status(401).json({ error: 'Missing bearer token' });
      }

      const { data, error } = await supabaseClient.auth.getUser(token);
      if (error || !data?.user) {
        console.error('Supabase getUser error:', error);
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
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = { id: sub, email, role: normalizedRole, raw: user as any };
      next();
    } catch (err) {
      console.error('Auth middleware error:', err);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
};


