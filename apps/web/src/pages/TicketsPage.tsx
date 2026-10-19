import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EmployeeRecentEventsResponse,
  KioskSearchResponse,
  Ticket,
  TicketActionResponse,
  TicketListResponse,
} from '@alche/shared';
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
  Pagination,
  Select,
  StatusPill,
  Table,
  TableSkeleton,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
  useToast,
} from '../components/ui';
import { PlusIcon, TicketIcon } from '../components/icons';
import {
  formatDateTime,
  localInputToIso,
  toLocalInputValue,
} from '../lib/dates';
import { useDebouncedValue } from '../lib/useDebouncedValue';

const STATUS_TONE: Record<Ticket['status'], 'NEUTRAL' | 'ON_SITE' | 'PRESENT' | 'ERROR' | 'INACTIVE'> =
  {
    open: 'NEUTRAL',
    approved: 'ON_SITE',
    applied: 'PRESENT',
    rejected: 'ERROR',
    withdrawn: 'INACTIVE',
  };

interface TicketFormState {
  employeeId: string;
  employeeName: string;
  targetEventId: string;
  direction: 'IN' | 'OUT';
  occurredAtLocal: string;
  reason: string;
}

const EMPTY_FORM: TicketFormState = {
  employeeId: '',
  employeeName: '',
  targetEventId: '',
  direction: 'IN',
  occurredAtLocal: toLocalInputValue(),
  reason: '',
};

export function TicketsPage() {
  const { user } = useAuth();
  const isHr = user?.role === 'HR';
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<TicketFormState>(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [actionTicket, setActionTicket] = useState<Ticket | null>(null);
  const [actionMode, setActionMode] = useState<'approve' | 'reject' | 'apply' | 'withdraw' | null>(
    null,
  );
  const [decisionDirection, setDecisionDirection] = useState<'IN' | 'OUT'>('IN');
  const [decisionTime, setDecisionTime] = useState(toLocalInputValue());
  const [reviewNote, setReviewNote] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const tickets = useQuery({
    queryKey: ['tickets', status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set('status', status);
      return apiFetch<TicketListResponse>(`/tickets?${params.toString()}`);
    },
  });

  const employeeSearch = useQuery({
    queryKey: ['tickets', 'employee-search', debouncedSearch],
    queryFn: () =>
      apiFetch<KioskSearchResponse>(`/kiosk/search?q=${encodeURIComponent(debouncedSearch.trim())}`),
    enabled: createOpen && debouncedSearch.trim().length >= 2 && !form.employeeId,
  });

  const recentEvents = useQuery({
    queryKey: ['tickets', 'recent-events', form.employeeId],
    queryFn: () =>
      apiFetch<EmployeeRecentEventsResponse>(
        `/employees/${form.employeeId}/recent-events?limit=30`,
      ),
    enabled: createOpen && Boolean(form.employeeId),
  });

  useEffect(() => {
    if (!actionTicket) return;
    setDecisionDirection(actionTicket.hrDirection ?? actionTicket.proposedDirection);
    setDecisionTime(
      toLocalInputValue(actionTicket.hrOccurredAt ?? actionTicket.proposedOccurredAt),
    );
    setReviewNote('');
    setFieldErrors({});
  }, [actionTicket]);

  const afterChange = async (message: string) => {
    toast.push({ title: message, tone: 'success' });
    setCreateOpen(false);
    setActionTicket(null);
    setActionMode(null);
    setForm(EMPTY_FORM);
    setSearch('');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      queryClient.invalidateQueries({ queryKey: ['attendance'] }),
      queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
    ]);
  };

  const createTicket = useMutation({
    mutationFn: () =>
      apiFetch<{ ticket: Ticket }>('/tickets', {
        method: 'POST',
        body: {
          employeeId: form.employeeId,
          targetEventId: form.targetEventId || null,
          proposedDirection: form.direction,
          proposedOccurredAt: localInputToIso(form.occurredAtLocal),
          reason: form.reason,
        },
      }),
    onSuccess: () => afterChange('Amendment ticket raised'),
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Could not raise the ticket',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const decide = useMutation({
    mutationFn: () => {
      if (!actionTicket || !actionMode) throw new Error('No ticket selected');
      if (actionMode === 'withdraw') {
        return apiFetch<TicketActionResponse>(`/tickets/${actionTicket.id}/withdraw`, {
          method: 'POST',
          body: { reason: reviewNote },
        });
      }
      if (actionMode === 'approve') {
        return apiFetch<TicketActionResponse>(`/tickets/${actionTicket.id}/approve`, {
          method: 'POST',
          body: {
            direction: decisionDirection,
            occurredAt: localInputToIso(decisionTime),
            reviewNote: reviewNote || null,
          },
        });
      }
      if (actionMode === 'reject') {
        return apiFetch<TicketActionResponse>(`/tickets/${actionTicket.id}/reject`, {
          method: 'POST',
          body: { reviewNote: reviewNote || null },
        });
      }
      return apiFetch<TicketActionResponse>(`/tickets/${actionTicket.id}/apply`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      const messages = {
        approve: 'Ticket approved — apply it when ready',
        reject: 'Ticket rejected',
        apply: 'Amendment applied to the attendance record',
        withdraw: 'Ticket withdrawn',
      };
      return afterChange(messages[actionMode!]);
    },
    onError: (error) => {
      toast.push({
        title: 'Ticket action failed',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    createTicket.mutate();
  };

  const selectEmployee = (id: string, name: string) => {
    setForm((current) => ({ ...current, employeeId: id, employeeName: name, targetEventId: '' }));
    setSearch(name);
  };

  const chooseTarget = (targetId: string) => {
    const target = recentEvents.data?.items.find((event) => event.id === targetId);
    setForm((current) => ({
      ...current,
      targetEventId: targetId,
      ...(target
        ? {
            direction: target.direction,
            occurredAtLocal: toLocalInputValue(target.occurredAt),
          }
        : {}),
    }));
  };

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Amendment tickets"
          description={
            isHr
              ? 'Review security corrections. Approval and application are separate, audited steps.'
              : 'Raise a correction for HR. You can see the state of tickets you raised.'
          }
          actions={
            <Button icon={<PlusIcon size={18} />} onClick={() => setCreateOpen(true)}>
              Raise ticket
            </Button>
          }
        />
        <Card>
          <div className="flex flex-wrap items-end gap-4">
            <Select
              label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              placeholder="All statuses"
              options={[
                { value: 'open', label: 'Open' },
                { value: 'approved', label: 'Approved' },
                { value: 'applied', label: 'Applied' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'withdrawn', label: 'Withdrawn' },
              ]}
              className="max-w-xs"
            />
            <div className="flex min-h-12 items-center gap-2 rounded-md bg-periwinkle px-4">
              <TicketIcon size={18} />
              <span className="text-body-sm text-ink">
                {tickets.data?.openCount ?? 0} open ticket
                {(tickets.data?.openCount ?? 0) === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {tickets.isLoading ? (
        <Card>
          <TableSkeleton rows={6} columns={7} />
        </Card>
      ) : tickets.isError ? (
        <ErrorState
          title="Tickets could not load."
          description={tickets.error instanceof ApiError ? tickets.error.message : undefined}
          onRetry={() => tickets.refetch()}
        />
      ) : tickets.data?.items.length === 0 ? (
        <EmptyState
          title="No amendment tickets here."
          description={
            isHr
              ? 'When security raises a correction it will appear here for review.'
              : 'Raise a ticket when an attendance time or direction needs correcting.'
          }
          action={
            <Button icon={<PlusIcon size={18} />} onClick={() => setCreateOpen(true)}>
              Raise ticket
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Proposed</TH>
                <TH>Target</TH>
                <TH>Reason</TH>
                <TH>Status</TH>
                <TH>Reviewed / applied</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {tickets.data?.items.map((ticket) => (
                <TR key={ticket.id}>
                  <TD>
                    <span className="font-medium text-ink">{ticket.employee.fullName}</span>
                    <span className="block text-caption text-slate">
                      {ticket.employee.code} · {ticket.employee.department}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <StatusPill tone={ticket.proposedDirection === 'IN' ? 'PRESENT' : 'INACTIVE'}>
                      {ticket.proposedDirection}
                    </StatusPill>
                    <span className="mt-1 block text-caption text-slate">
                      {formatDateTime(ticket.proposedOccurredAt)}
                    </span>
                  </TD>
                  <TD>
                    {ticket.targetEvent ? (
                      <span className="text-caption text-slate">
                        Existing {ticket.targetEvent.direction} at{' '}
                        {formatDateTime(ticket.targetEvent.occurredAt)}
                      </span>
                    ) : (
                      <Badge>Missing event</Badge>
                    )}
                  </TD>
                  <TD className="max-w-[280px]">{ticket.reason}</TD>
                  <TD>
                    <StatusPill tone={STATUS_TONE[ticket.status]}>{ticket.status}</StatusPill>
                    {ticket.status === 'approved' && ticket.hrOccurredAt ? (
                      <span className="mt-1 block text-caption text-slate">
                        HR: {ticket.hrDirection} {formatDateTime(ticket.hrOccurredAt)}
                      </span>
                    ) : null}
                  </TD>
                  <TD className="text-caption text-slate">
                    {ticket.reviewedAt
                      ? `${ticket.reviewedBy?.displayName ?? 'Withdrawn'} · ${formatDateTime(ticket.reviewedAt)}`
                      : '—'}
                    {ticket.appliedAt ? (
                      <span className="block">Applied {formatDateTime(ticket.appliedAt)}</span>
                    ) : null}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {ticket.status === 'open' ? (
                        <Button
                          variant="text"
                          size="sm"
                          onClick={() => {
                            setActionTicket(ticket);
                            setActionMode('withdraw');
                          }}
                          disabled={ticket.raisedBy.id !== user?.id}
                        >
                          Withdraw
                        </Button>
                      ) : null}
                      {isHr && ticket.status === 'open' ? (
                        <>
                          <Button
                            variant="outlined"
                            size="sm"
                            onClick={() => {
                              setActionTicket(ticket);
                              setActionMode('approve');
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="text"
                            size="sm"
                            onClick={() => {
                              setActionTicket(ticket);
                              setActionMode('reject');
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                      {isHr && ticket.status === 'approved' ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setActionTicket(ticket);
                            setActionMode('apply');
                          }}
                        >
                          Apply
                        </Button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={tickets.data?.meta.page ?? 1}
            totalPages={tickets.data?.meta.totalPages ?? 1}
            onPage={setPage}
          />
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Raise an amendment ticket"
        description="Security cannot edit history. HR decides whether the correction is applied."
        size="lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="ticket-form"
              loading={createTicket.isPending}
              disabled={!form.employeeId || !form.reason}
            >
              Raise ticket
            </Button>
          </>
        }
      >
        <form id="ticket-form" className="space-y-4" onSubmit={submitCreate}>
          <Input
            label="Employee"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setForm((current) => ({ ...current, employeeId: '', employeeName: '', targetEventId: '' }));
            }}
            placeholder="Search by name or staff number"
            error={fieldErrors.employeeId}
            required
          />
          {!form.employeeId && debouncedSearch.trim().length >= 2 ? (
            <div className="max-h-56 overflow-y-auto rounded-md border border-mist">
              {employeeSearch.isLoading ? (
                <p className="p-3 text-body-sm text-slate">Searching…</p>
              ) : employeeSearch.data?.employees.length ? (
                employeeSearch.data.employees.map((employee) => (
                  <button
                    key={employee.id}
                    type="button"
                    className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-mist px-3 text-left last:border-0 hover:bg-cloud"
                    onClick={() => selectEmployee(employee.id, employee.fullName)}
                  >
                    <span className="text-body-sm text-ink">{employee.fullName}</span>
                    <span className="text-caption text-slate">{employee.code}</span>
                  </button>
                ))
              ) : (
                <p className="p-3 text-body-sm text-slate">No matching employee.</p>
              )}
            </div>
          ) : null}

          {form.employeeId ? (
            <>
              <Select
                label="Target"
                value={form.targetEventId}
                onChange={(event) => chooseTarget(event.target.value)}
                options={[
                  { value: '', label: 'Missing event — not in the log' },
                  ...(recentEvents.data?.items.map((event) => ({
                    value: event.id,
                    label: `Correct ${event.direction} at ${formatDateTime(event.occurredAt)}`,
                  })) ?? []),
                ]}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <Select
                  label="Proposed direction"
                  value={form.direction}
                  onChange={(event) =>
                    setForm({ ...form, direction: event.target.value as 'IN' | 'OUT' })
                  }
                  options={[
                    { value: 'IN', label: 'IN' },
                    { value: 'OUT', label: 'OUT' },
                  ]}
                />
                <Input
                  label="Proposed local time"
                  type="datetime-local"
                  value={form.occurredAtLocal}
                  onChange={(event) =>
                    setForm({ ...form, occurredAtLocal: event.target.value })
                  }
                  error={fieldErrors.proposedOccurredAt}
                  required
                />
              </div>
              <Textarea
                label="Reason"
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
                error={fieldErrors.reason}
                hint="Mandatory. Explain what the logbook or witness shows."
                required
              />
            </>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(actionTicket && actionMode)}
        onClose={() => {
          setActionTicket(null);
          setActionMode(null);
        }}
        title={
          actionMode === 'approve'
            ? 'Approve ticket'
            : actionMode === 'reject'
              ? 'Reject ticket'
              : actionMode === 'apply'
                ? 'Apply approved amendment'
                : 'Withdraw ticket'
        }
        description={
          actionMode === 'apply'
            ? 'This writes a new amendment event and supersedes the old event. It cannot be applied twice.'
            : actionTicket
              ? `${actionTicket.employee.fullName} · ${actionTicket.reason}`
              : undefined
        }
        footer={
          <>
            <Button
              variant="outlined"
              onClick={() => {
                setActionTicket(null);
                setActionMode(null);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={decide.isPending}
              disabled={
                (actionMode === 'withdraw' && reviewNote.trim().length < 3) ||
                (actionMode === 'reject' && reviewNote.trim().length > 1000)
              }
              onClick={() => decide.mutate()}
            >
              {actionMode === 'approve'
                ? 'Approve'
                : actionMode === 'reject'
                  ? 'Reject'
                  : actionMode === 'apply'
                    ? 'Apply amendment'
                    : 'Withdraw'}
            </Button>
          </>
        }
      >
        {actionMode === 'approve' ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Applied direction"
                value={decisionDirection}
                onChange={(event) => setDecisionDirection(event.target.value as 'IN' | 'OUT')}
                options={[
                  { value: 'IN', label: 'IN' },
                  { value: 'OUT', label: 'OUT' },
                ]}
              />
              <Input
                label="Applied local time"
                type="datetime-local"
                value={decisionTime}
                onChange={(event) => setDecisionTime(event.target.value)}
              />
            </div>
            <Textarea
              label="Review note"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              hint="Optional. Shown to the officer and stored in the audit log."
            />
          </div>
        ) : actionMode === 'reject' || actionMode === 'withdraw' ? (
          <Textarea
            label={actionMode === 'reject' ? 'Reason for rejection' : 'Reason for withdrawal'}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            required
          />
        ) : null}
      </Modal>
    </div>
  );
}
