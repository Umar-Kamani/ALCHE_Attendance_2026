import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { ChangePasswordBodySchema } from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { Brand } from '../components/Brand';
import { Button, Card, Input } from '../components/ui';

export function ChangePasswordPage() {
  const { user, isLoading, refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      }),
    onSuccess: async () => {
      await refresh();
      navigate(user?.role === 'DEAN' ? '/dashboard' : '/kiosk', { replace: true });
    },
  });

  if (!isLoading && !user) return <Navigate to="/login" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const parsed = ChangePasswordBodySchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? 'Check the password fields.');
      return;
    }
    if (newPassword !== confirm) {
      setLocalError('The new passwords do not match.');
      return;
    }
    mutation.mutate();
  };

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fieldErrors() : {};

  return (
    <main className="flex min-h-screen items-center justify-center bg-cloud px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <Card className="p-8">
          <h1 className="text-heading-sm font-medium tracking-heading-sm text-ink">
            {user?.mustChangePassword ? 'Choose a permanent password' : 'Change password'}
          </h1>
          <p className="mt-1 text-body-sm text-slate">
            {user?.mustChangePassword
              ? 'Your temporary password must be replaced before you can use the gate screens.'
              : 'Use at least 12 characters. Other active sessions will be signed out.'}
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              error={fieldErrors.currentPassword}
              required
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              error={fieldErrors.newPassword}
              hint="At least 12 characters."
              required
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              error={confirm && confirm !== newPassword ? 'The new passwords do not match.' : undefined}
              required
            />

            {localError || mutation.isError ? (
              <p role="alert" className="rounded-md bg-error-surface px-3 py-2 text-body-sm text-error-ink">
                {localError ??
                  (mutation.error instanceof ApiError
                    ? mutation.error.message
                    : 'Could not change the password. Try again.')}
              </p>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={mutation.isPending}
              disabled={!currentPassword || !newPassword || !confirm}
            >
              Save password
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
