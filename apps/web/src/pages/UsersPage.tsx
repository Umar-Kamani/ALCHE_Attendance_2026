import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role, UserAdmin, UserAdminListResponse } from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusPill,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '../components/ui';
import { PlusIcon } from '../components/icons';
import { formatDateTime } from '../lib/dates';

interface CreateForm {
  username: string;
  displayName: string;
  role: Role;
}

const emptyForm: CreateForm = { username: '', displayName: '', role: 'SECURITY' };

export function UsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string } | null>(
    null,
  );
  const [roleUser, setRoleUser] = useState<UserAdmin | null>(null);
  const [newRole, setNewRole] = useState<Role>('SECURITY');

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<UserAdminListResponse>('/users?page=1'),
  });

  const createUser = useMutation({
    mutationFn: () =>
      apiFetch<{ user: UserAdmin; temporaryPassword: string }>('/users', {
        method: 'POST',
        body: form,
      }),
    onSuccess: async (data) => {
      setCreateOpen(false);
      setForm(emptyForm);
      setTempPassword({ username: data.user.username, password: data.temporaryPassword });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'User could not be created',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) =>
      apiFetch<UserAdmin>(`/users/${id}/deactivate`, { method: 'POST' }),
    onSuccess: async () => {
      toast.push({ title: 'User deactivated', message: 'Their sessions were revoked.', tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      toast.push({
        title: 'Could not deactivate user',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const resetPassword = useMutation({
    mutationFn: (target: UserAdmin) =>
      apiFetch<{ temporaryPassword: string }>(`/users/${target.id}/reset-password`, {
        method: 'POST',
      }).then((data) => ({ username: target.username, password: data.temporaryPassword })),
    onSuccess: (data) => {
      setTempPassword(data);
      toast.push({ title: 'Password reset', tone: 'success' });
    },
    onError: (error) => {
      toast.push({
        title: 'Could not reset password',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const changeRole = useMutation({
    mutationFn: () =>
      apiFetch<UserAdmin>(`/users/${roleUser!.id}/role`, {
        method: 'PATCH',
        body: { role: newRole },
      }),
    onSuccess: async () => {
      toast.push({ title: 'Role updated', tone: 'success' });
      setRoleUser(null);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      toast.push({
        title: 'Could not change role',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Users"
          description="Accounts for security, HR and the read-only dean dashboard. The last active HR administrator is protected."
          actions={
            <Button
              icon={<PlusIcon size={18} />}
              onClick={() => {
                setForm(emptyForm);
                setFieldErrors({});
                setCreateOpen(true);
              }}
            >
              Add user
            </Button>
          }
        />
      </div>

      {users.isLoading ? (
        <Card>
          <TableSkeleton rows={5} columns={5} />
        </Card>
      ) : users.isError ? (
        <ErrorState title="Users could not load." onRetry={() => users.refetch()} />
      ) : users.data?.items.length === 0 ? (
        <EmptyState title="No users yet." description="Create the first account." />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH>Last login</TH>
                <TH>Created</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {users.data?.items.map((account) => (
                <TR key={account.id}>
                  <TD>
                    {account.displayName}
                    <span className="block text-caption text-slate">{account.username}</span>
                  </TD>
                  <TD>
                    <Badge>{account.role}</Badge>
                  </TD>
                  <TD>
                    <StatusPill tone={account.active ? 'PRESENT' : 'INACTIVE'}>
                      {account.active ? 'ACTIVE' : 'INACTIVE'}
                    </StatusPill>
                    {account.mustChangePassword ? (
                      <span className="mt-1 block text-caption text-slate">Password change due</span>
                    ) : null}
                  </TD>
                  <TD>{account.lastLoginAt ? formatDateTime(account.lastLoginAt) : '—'}</TD>
                  <TD>{formatDateTime(account.createdAt)}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="text"
                        size="sm"
                        onClick={() => {
                          setRoleUser(account);
                          setNewRole(account.role);
                        }}
                      >
                        Role
                      </Button>
                      <Button
                        variant="text"
                        size="sm"
                        loading={resetPassword.isPending}
                        onClick={() => resetPassword.mutate(account)}
                      >
                        Reset password
                      </Button>
                      {account.active && account.id !== user?.id ? (
                        <Button
                          variant="text"
                          size="sm"
                          loading={deactivate.isPending}
                          onClick={() => deactivate.mutate(account.id)}
                        >
                          Deactivate
                        </Button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="mt-3 text-caption text-slate">
            Showing the first 50 accounts. Deactivation immediately revokes sessions and preserves
            historical attribution.
          </p>
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add user"
        description="The temporary password is shown once. The user must change it at first sign-in."
        footer={
          <>
            <Button variant="outlined" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createUser.isPending}
              disabled={!form.username || !form.displayName}
              onClick={() => createUser.mutate()}
            >
              Create user
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Display name"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            error={fieldErrors.displayName}
            required
          />
          <Input
            label="Username"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            error={fieldErrors.username}
            required
          />
          <Select
            label="Role"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
            options={[
              { value: 'SECURITY', label: 'Security' },
              { value: 'HR', label: 'HR' },
              { value: 'DEAN', label: 'Dean — read only' },
            ]}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(tempPassword)}
        onClose={() => setTempPassword(null)}
        title="Temporary password"
        description="Copy this now. It is not stored in readable form and will not be shown again."
        footer={
          <Button onClick={() => setTempPassword(null)}>I have copied it</Button>
        }
      >
        {tempPassword ? (
          <div className="space-y-3">
            <p className="text-body-sm text-slate">
              Username: <strong className="text-ink">{tempPassword.username}</strong>
            </p>
            <code className="block select-all rounded-md bg-cloud p-4 font-mono text-body text-ink">
              {tempPassword.password}
            </code>
            <p className="text-body-sm text-slate">
              The account is forced to change this password immediately after signing in.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(roleUser)}
        onClose={() => setRoleUser(null)}
        title="Change role"
        description={
          roleUser
            ? `${roleUser.displayName} · currently ${roleUser.role}`
            : undefined
        }
        footer={
          <>
            <Button variant="outlined" onClick={() => setRoleUser(null)}>
              Cancel
            </Button>
            <Button loading={changeRole.isPending} onClick={() => changeRole.mutate()}>
              Save role
            </Button>
          </>
        }
      >
        <Select
          label="New role"
          value={newRole}
          onChange={(event) => setNewRole(event.target.value as Role)}
          options={[
            { value: 'SECURITY', label: 'Security' },
            { value: 'HR', label: 'HR' },
            { value: 'DEAN', label: 'Dean — read only' },
          ]}
        />
      </Modal>
    </div>
  );
}
