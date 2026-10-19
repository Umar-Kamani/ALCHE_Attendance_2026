import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '@alche/shared';
import { useAuth } from './AuthProvider';
import { Skeleton } from '../components/ui';
import { ForbiddenPage } from '../pages/ForbiddenPage';

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cloud">
        <div className="w-full max-w-sm space-y-3 p-8" aria-label="Loading session">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <ForbiddenPage />;
  }

  return <Outlet />;
}
