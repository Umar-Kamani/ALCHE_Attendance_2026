import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import type { AttendanceEvent, MonthAttendanceResponse } from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
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
  Textarea,
  TH,
  THead,
  TR,
  useToast,
} from '../components/ui';
import { PlusIcon } from '../components/icons';
import {
  formatDateTime,
  formatMonth,
  monthDays,
  currentMonth,
  localInputToIso,
  toLocalInputValue,
} from '../lib/dates';
import { statusToneClasses, statusToneFor } from '../components/ui/StatusPill';
import { cn } from '../lib/cn';

const STATUS_SHORT: Record<string, string> = {
  PRESENT: 'Present',
  ON_SITE: 'On site',
  MISSING_IN: 'Missing IN',
  ABSENT: 'Absent',
};

type EventMode = 'add' | 'amend' | 'void';

export function EmployeeAttendancePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [eventMode, setEventMode] = useState<EventMode | null>(null);
  const [eventTarget, setEventTarget] = useState<AttendanceEvent | null>(null);
  const [eventDirection, setEventDirection] = useState<'IN' | 'OUT'>('IN');
  const [eventTime, setEventTime] = useState(toLocalInputValue());
  const [eventReason, setEventReason] = useState('');
  const [eventNote, setEventNote] = useState('');
  const [eventError, setEventError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['attendance', 'month', employeeId, month],
    queryFn: () =>
      apiFetch<MonthAttendanceResponse>(
        `/attendance/${employeeId}/month?month=${encodeURIComponent(month)}`,
      ),
    enabled: Boolean(employeeId),
  });

  const eventMutation = useMutation({
    mutationFn: () => {
      if (!eventMode) throw new Error('No event action');
      if (eventMode === 'void') {
        return apiFetch(`/events/${eventTarget!.id}/void`, {
          method: 'POST',
          body: { reason: eventReason },
        });
      }
      if (eventMode === 'amend') {
        return apiFetch(`/events/${eventTarget!.id}/amend`, {
          method: 'POST',
          body: {
            direction: eventDirection,
            occurredAt: localInputToIso(eventTime),
            reason: eventReason,
            ...(eventNote ? { note: eventNote } : {}),
          },
        });
      }
      return apiFetch('/events', {
        method: 'POST',
        body: {
          employeeId,
          direction: eventDirection,
          occurredAt: localInputToIso(eventTime),
          hrEdit: true,
          reason: eventReason,
          ...(eventNote ? { note: eventNote } : {}),
        },
      });
    },
    onSuccess: async () => {
      toast.push({
        title:
          eventMode === 'add'
            ? 'Event added'
            : eventMode === 'amend'
              ? 'Event re-timed'
              : 'Event voided',
        tone: 'success',
      });
      setEventMode(null);
      setEventTarget(null);
      setEventError(null);
      await queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (error) => {
      setEventError(error instanceof ApiError ? error.message : 'The change could not be saved.');
    },
  });

  const openAdd = () => {
    setEventMode('add');
    setEventTarget(null);
    setEventDirection('IN');
    setEventTime(toLocalInputValue());
    setEventReason('');
    setEventNote('');
    setEventError(null);
  };
  const openAmend = (event: AttendanceEvent) => {
    setEventMode('amend');
    setEventTarget(event);
    setEventDirection(event.direction);
    setEventTime(toLocalInputValue(event.occurredAt));
    setEventReason('');
    setEventNote(event.note ?? '');
    setEventError(null);
  };
  const openVoid = (event: AttendanceEvent) => {
    setEventMode('void');
    setEventTarget(event);
    setEventReason('');
    setEventError(null);
  };

  const months = Array.from({ length: 13 }, (_, index) =>
    DateTime.now().minus({ months: index }).toFormat('yyyy-MM'),
  );
  const options = months.map((value) => ({ value, label: formatMonth(value) }));
  if (!options.some((option) => option.value === month)) {
    options.unshift({ value: month, label: formatMonth(month) });
  }

  if (query.isError) {
    return (
      <div className="space-y-8">
        <Link to="/attendance" className="text-body-sm font-medium text-slate underline-offset-2 hover:underline">
          ← Back to attendance
        </Link>
        <ErrorState
          title="This employee’s attendance could not load."
          description={query.error instanceof ApiError ? query.error.message : undefined}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  const employee = query.data?.employee;
  const dayMap = new Map((query.data?.days ?? []).map((day) => [day.date, day]));
  const days = monthDays(month);
  const monthStart = DateTime.fromISO(`${month}-01`);
  const leading = (monthStart.weekday + 6) % 7;
  const calendarCells: Array<{ date: string } | null> = [
    ...Array.from({ length: leading }, () => null),
    ...days.map((date) => ({ date })),
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  return (
    <div className="space-y-16">
      <div>
        <Link to="/attendance" className="text-body-sm font-medium text-slate underline-offset-2 hover:underline">
          ← Back to attendance
        </Link>
        <PageHeader
          title={employee ? `${employee.firstName} ${employee.lastName}` : 'Employee attendance'}
          description={
            employee
              ? `${employee.code} · ${employee.department} · ${employee.category === 'staff' ? 'Staff' : 'Contractor'}`
              : 'Month calendar and effective event log.'
          }
          actions={
            <Select
              label="Month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              options={options}
              className="min-w-[180px]"
            />
          }
        />
      </div>

      {query.isLoading || !employee ? (
        <Card>
          <TableSkeleton rows={6} columns={6} />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={formatMonth(month)}
              description="Each day is derived from effective attendance events. Hover or read the label — state is never colour-only."
            />
            <div className="grid grid-cols-7 gap-1.5" aria-label={`Attendance calendar for ${formatMonth(month)}`}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
                <div key={label} className="px-2 py-1 text-caption font-medium uppercase tracking-caption text-slate">
                  {label}
                </div>
              ))}
              {calendarCells.map((cell, index) => {
                if (!cell) return <div key={`empty-${index}`} className="min-h-[76px]" />;
                const day = dayMap.get(cell.date);
                const status = day?.status ?? 'ABSENT';
                return (
                  <div
                    key={cell.date}
                    className={cn(
                      'min-h-[76px] rounded-md p-2',
                      statusToneClasses[statusToneFor(status)],
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-caption font-medium">{Number(cell.date.slice(-2))}</span>
                      {day?.amended ? <span className="text-caption">A</span> : null}
                    </div>
                    <p className="mt-2 text-caption font-medium">{STATUS_SHORT[status] ?? status}</p>
                    {day?.firstInLocal ? (
                      <p className="text-caption">
                        {day.firstInLocal.slice(0, 5)}
                        {day.lastOutLocal ? `–${day.lastOutLocal.slice(0, 5)}` : ''}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {Object.entries(STATUS_SHORT).map(([status, label]) => (
                <StatusPill key={status} status={status}>
                  {label}
                </StatusPill>
              ))}
              <StatusPill tone="NEUTRAL">A = amended</StatusPill>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Event log"
              description="Effective events only. Superseded and voided events remain in the audit log."
              action={
                <Button icon={<PlusIcon size={18} />} onClick={openAdd}>
                  Add event
                </Button>
              }
            />
            {query.data?.events.length === 0 ? (
              <p className="text-body-sm text-slate">No effective events in this month.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Local time</TH>
                    <TH>Direction</TH>
                    <TH>Source</TH>
                    <TH>Recorded by</TH>
                    <TH>Note</TH>
                    <TH>Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {query.data?.events.map((event) => (
                    <TR key={event.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(event.occurredAt)}</TD>
                      <TD>
                        <StatusPill tone={event.direction === 'IN' ? 'PRESENT' : 'INACTIVE'}>
                          {event.direction}
                        </StatusPill>
                      </TD>
                      <TD>
                        <Badge>{event.source}</Badge>
                      </TD>
                      <TD>{event.recordedBy ?? '—'}</TD>
                      <TD>{event.note ?? '—'}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="text" size="sm" onClick={() => openAmend(event)}>
                            Re-time
                          </Button>
                          <Button variant="text" size="sm" onClick={() => openVoid(event)}>
                            Void
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}

      <Modal
        open={Boolean(eventMode)}
        onClose={() => setEventMode(null)}
        title={
          eventMode === 'add'
            ? 'Add attendance event'
            : eventMode === 'amend'
              ? 'Re-time event'
              : 'Void event'
        }
        description={
          eventMode === 'add'
            ? 'HR creates a new event with source hr_edit. It appears in reports immediately.'
            : eventMode === 'amend'
              ? 'Creates a new hr_edit event and supersedes the old one. Both remain in audit history.'
              : 'The event stays in audit history but disappears from reports and exports.'
        }
        footer={
          <>
            <Button variant="outlined" onClick={() => setEventMode(null)}>
              Cancel
            </Button>
            <Button
              loading={eventMutation.isPending}
              disabled={eventReason.trim().length < 3}
              onClick={() => {
                setEventError(null);
                eventMutation.mutate();
              }}
            >
              {eventMode === 'add' ? 'Add event' : eventMode === 'amend' ? 'Re-time event' : 'Void event'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {eventMode !== 'void' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Direction"
                value={eventDirection}
                onChange={(event) => setEventDirection(event.target.value as 'IN' | 'OUT')}
                options={[
                  { value: 'IN', label: 'IN' },
                  { value: 'OUT', label: 'OUT' },
                ]}
              />
              <Input
                label="Local time"
                type="datetime-local"
                value={eventTime}
                onChange={(event) => setEventTime(event.target.value)}
                required
              />
            </div>
          ) : null}
          {eventTarget ? (
            <p className="rounded-md bg-cloud px-3 py-2 text-body-sm text-slate">
              Current: {eventTarget.direction} at {formatDateTime(eventTarget.occurredAt)}
            </p>
          ) : null}
          <Textarea
            label="Reason"
            value={eventReason}
            onChange={(event) => setEventReason(event.target.value)}
            hint="Mandatory and stored in the audit log."
            required
          />
          {eventMode !== 'void' ? (
            <Textarea
              label="Note"
              value={eventNote}
              onChange={(event) => setEventNote(event.target.value)}
            />
          ) : null}
          {eventError ? (
            <p className="rounded-md bg-error-surface px-3 py-2 text-body-sm text-error-ink">
              {eventError}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
