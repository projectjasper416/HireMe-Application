import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: string;
  userRole?: string;
}

export function ProtectedRoute({ children, requiredRole, userRole }: ProtectedRouteProps) {
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

