import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (user.role === 'DEAN') return <Navigate to="/dashboard" replace />;
  return <Navigate to="/kiosk" replace />;
}
