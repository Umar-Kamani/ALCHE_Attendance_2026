import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { HomeRedirect } from './auth/HomeRedirect';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { KioskPage } from './pages/KioskPage';
import { AttendancePage } from './pages/AttendancePage';
import { EmployeeAttendancePage } from './pages/EmployeeAttendancePage';
import { TicketsPage } from './pages/TicketsPage';
import { VehiclesPage } from './pages/VehiclesPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { UsersPage } from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import { OnCampusPage } from './pages/OnCampusPage';
import { DashboardPage } from './pages/DashboardPage';

export function App() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { signOutLocal } = useAuth();

  useEffect(() => {
    const onExpired = () => {
      signOutLocal();
      navigate('/login', { replace: true });
    };
    window.addEventListener('alche:session-expired', onExpired);
    return () => window.removeEventListener('alche:session-expired', onExpired);
  }, [navigate, queryClient, signOutLocal]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/403" element={<ForbiddenPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
      </Route>

      <Route element={<ProtectedRoute roles={['SECURITY', 'HR']} />}>
        <Route element={<AppShell />}>
          <Route path="/kiosk" element={<KioskPage />} />
          <Route path="/on-campus" element={<OnCampusPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/tickets" element={<TicketsPage />} />

          <Route element={<ProtectedRoute roles={['HR']} />}>
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/attendance/:employeeId" element={<EmployeeAttendancePage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Route>
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['DEAN']} />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
        </Route>
      </Route>

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
