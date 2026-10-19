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
import { PlaceholderPage } from './pages/PlaceholderPage';

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
          <Route
            path="/kiosk"
            element={<PlaceholderPage title="Gate kiosk" description="Staff entry and exit." />}
          />
          <Route
            path="/on-campus"
            element={<PlaceholderPage title="On campus now" description="Live campus occupancy." />}
          />
          <Route
            path="/guests"
            element={<PlaceholderPage title="Guest register" description="Visits and expected arrivals." />}
          />
          <Route
            path="/parking"
            element={<PlaceholderPage title="Parking board" description="Live bay occupancy." />}
          />
          <Route
            path="/parking/bays"
            element={<PlaceholderPage title="Bay inventory" description="Areas and bays." />}
          />
          <Route
            path="/parking/history"
            element={<PlaceholderPage title="Parking history" description="Occupancy and dwell." />}
          />
          <Route
            path="/vehicles"
            element={<PlaceholderPage title="Vehicles" description="Registered campus vehicles." />}
          />
          <Route
            path="/tickets"
            element={<PlaceholderPage title="Amendment tickets" description="Attendance corrections." />}
          />

          <Route element={<ProtectedRoute roles={['HR']} />}>
            <Route
              path="/attendance"
              element={<PlaceholderPage title="Attendance" description="Daily attendance records." />}
            />
            <Route
              path="/attendance/:employeeId"
              element={<PlaceholderPage title="Employee attendance" description="Month calendar." />}
            />
            <Route
              path="/employees"
              element={<PlaceholderPage title="Employees" description="Staff directory and import." />}
            />
            <Route
              path="/students"
              element={<PlaceholderPage title="Students" description="Parking eligibility directory." />}
            />
            <Route
              path="/users"
              element={<PlaceholderPage title="Users" description="Accounts and roles." />}
            />
            <Route
              path="/audit"
              element={<PlaceholderPage title="Audit log" description="Append-only activity record." />}
            />
          </Route>
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['DEAN']} />}>
        <Route element={<AppShell />}>
          <Route
            path="/dashboard"
            element={<PlaceholderPage title="Campus dashboard" description="Read-only operational statistics." />}
          />
        </Route>
      </Route>

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
