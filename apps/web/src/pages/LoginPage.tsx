import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginBodySchema, type LoginResponse } from '@alche/shared';
import { ApiError, apiFetch, setCsrfToken } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { Brand } from '../components/Brand';
import { Button, Card, Input } from '../components/ui';

export function LoginPage() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { username, password },
      }),
    onSuccess: (data) => {
      setCsrfToken(data.csrfToken);
      queryClient.setQueryData(['auth', 'me'], { user: data.user });
      if (data.user.mustChangePassword) {
        navigate('/change-password', { replace: true });
        return;
      }
      const requested = (location.state as { from?: string } | null)?.from;
      const target =
        requested && requested !== '/login'
          ? requested
          : data.user.role === 'DEAN'
            ? '/dashboard'
            : '/kiosk';
      navigate(target, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
    },
  });

  if (!isLoading && user) {
    return <Navigate to={user.role === 'DEAN' ? '/dashboard' : '/kiosk'} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    const parsed = LoginBodySchema.safeParse({ username, password });
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_root';
        errors[key] ??= [];
        errors[key].push(issue.message);
      }
      setFieldErrors(errors);
      return;
    }
    mutation.mutate();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-cloud px-4 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-md">
        <div className="mb-7 flex justify-center">
          <Brand />
        </div>
        <Card className="p-9 sm:p-10">
          <div className="mb-6">
            <h1 className="text-heading-sm font-medium tracking-heading-sm text-ink">Sign in</h1>
            <p className="mt-1 text-body-sm text-slate">
              Use the account provided by HR. Gate and office share this system.
            </p>
          </div>

          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <Input
              label="Username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              error={fieldErrors.username}
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
              required
            />

            {mutation.isError ? (
              <p role="alert" className="rounded-md bg-error-surface px-3 py-2 text-body-sm text-error-ink">
                {mutation.error instanceof ApiError
                  ? mutation.error.message
                  : 'Could not sign in. Check the connection and try again.'}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={mutation.isPending}
              disabled={!username || !password}
            >
              Sign in
            </Button>
          </form>
        </Card>
        <p className="mt-5 text-center text-caption text-slate">
          ALCHE · African Leadership College of Higher Education · Pamplemousses
        </p>
      </div>
    </main>
  );
}
