import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceResponse } from '@alche/shared';
import { ApiError, apiDownload, apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
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
import { DownloadIcon, RefreshIcon } from '../components/icons';
import { currentMonthStart, formatDate, hoursLabel, todayLocal } from '../lib/dates';

interface Filters {
  from: string;
  to: string;
  department: string;
  category: string;
  status: string;
  page: number;
}

export function AttendancePage() {
  const { user } = useAuth();
  const isHr = user?.role === 'HR';
  const toast = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>({
    from: currentMonthStart(),
    to: todayLocal(),
    department: '',
    category: '',
    status: '',
    page: 1,
  });
  const [draft, setDraft] = useState(filters);

  const query = useQuery({
    queryKey: ['attendance', filters],
    queryFn: () => {
      const params = new URLSearchParams({
        from: filters.from,
        to: filters.to,
        page: String(filters.page),
      });
      if (filters.department) params.set('department', filters.department);
      if (filters.category) params.set('category', filters.category);
      if (filters.status) params.set('status', filters.status);
      return apiFetch<AttendanceResponse>(`/attendance?${params.toString()}`);
    },
  });

  const departments = useQuery({
    queryKey: ['employees', 'departments'],
    queryFn: () => apiFetch<{ departments: string[] }>('/employees?page=1'),
    enabled: isHr,
  });

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters({ ...draft, page: 1 });
  };

  const exportCsv = async (kind: 'attendance' | 'events') => {
    const params = new URLSearchParams({ from: filters.from, to: filters.to });
    if (kind === 'attendance') {
      if (filters.department) params.set('department', filters.department);
      if (filters.category) params.set('category', filters.category);
      if (filters.status) params.set('status', filters.status);
    }
    try {
      await apiDownload(
        `/${kind}/export.csv?${params.toString()}`,
        `${kind}_${filters.from}_${filters.to}.csv`,
      );
      toast.push({
        title: 'Export downloaded',
        message: `${kind === 'attendance' ? 'Attendance' : 'Raw events'} from ${filters.from} to ${filters.to}.`,
        tone: 'success',
      });
    } catch (error) {
      toast.push({
        title: 'Export failed',
        message: error instanceof ApiError ? error.message : 'Could not generate the export.',
        tone: 'error',
      });
    }
  };

  const totals = query.data?.totals;
  const today = todayLocal();

  const reset = () => {
    const next: Filters = {
      from: isHr ? currentMonthStart() : today,
      to: today,
      department: '',
      category: '',
      status: '',
      page: 1,
    };
    setDraft(next);
    setFilters(next);
  };

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Attendance"
          description={
            isHr
              ? 'Daily first-in and last-out records for every employee. Derived from the immutable event log.'
              : 'Today’s attendance only. Security accounts cannot view historical records.'
          }
          actions={
            isHr ? (
              <>
                <Button
                  variant="outlined"
                  icon={<DownloadIcon size={18} />}
                  onClick={() => exportCsv('events')}
                >
                  Raw events CSV
                </Button>
                <Button icon={<DownloadIcon size={18} />} onClick={() => exportCsv('attendance')}>
                  Export report
                </Button>
              </>
            ) : undefined
          }
        />

        <Card>
          <form onSubmit={apply} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {isHr ? (
              <>
                <Input
                  label="From"
                  type="date"
                  value={draft.from}
                  onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                  required
                />
                <Input
                  label="To"
                  type="date"
                  value={draft.to}
                  onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                  required
                />
              </>
            ) : (
              <div className="md:col-span-2">
                <p className="text-caption font-medium uppercase tracking-caption text-slate">Date</p>
                <p className="mt-1 text-body text-ink">{formatDate(today)} · today only</p>
              </div>
            )}
            <Select
              label="Department"
              value={draft.department}
              onChange={(event) => setDraft({ ...draft, department: event.target.value })}
              placeholder="All departments"
              options={(departments.data?.departments ?? []).map((department) => ({
                value: department,
                label: department,
              }))}
              disabled={!isHr}
            />
            <Select
              label="Category"
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              placeholder="All categories"
              options={[
                { value: 'staff', label: 'Staff' },
                { value: 'contractor', label: 'Contractor' },
              ]}
              disabled={!isHr}
            />
            <Select
              label="Status"
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              placeholder="All statuses"
              options={[
                { value: 'PRESENT', label: 'Present' },
                { value: 'ON_SITE', label: 'On site' },
                { value: 'MISSING_IN', label: 'Missing IN' },
                { value: 'ABSENT', label: 'Absent' },
              ]}
            />
            <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-5">
              <Button type="submit" icon={<RefreshIcon size={18} />}>
                Apply filters
              </Button>
              <Button variant="outlined" onClick={reset}>
                Reset
              </Button>
              {!isHr ? (
                <p className="text-body-sm text-slate">
                  Historical attendance is restricted to HR. Use the kiosk for gate actions.
                </p>
              ) : null}
            </div>
          </form>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Present', totals?.present ?? 0],
          ['On site', totals?.onSite ?? 0],
          ['Missing IN', totals?.missingIn ?? 0],
          ['Absent', totals?.absent ?? 0],
          ['Average span', hoursLabel(totals?.averageSpanHours ?? null)],
        ].map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-caption font-medium uppercase tracking-caption text-slate">{label}</p>
            <p className="mt-1 text-heading-sm font-medium text-ink">{value}</p>
          </Card>
        ))}
      </div>

      {query.isLoading ? (
        <Card>
          <TableSkeleton rows={8} columns={7} />
        </Card>
      ) : query.isError ? (
        <ErrorState
          title="Attendance could not load."
          description={query.error instanceof ApiError ? query.error.message : undefined}
          onRetry={() => query.refetch()}
        />
      ) : query.data?.items.length === 0 ? (
        <EmptyState
          title="No attendance rows match these filters."
          description="Try a broader date range, or clear the department, category and status filters."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Employee</TH>
                <TH>Department</TH>
                <TH>Status</TH>
                <TH>First in</TH>
                <TH>Last out</TH>
                <TH>Span</TH>
                <TH>Net</TH>
                <TH>Visits</TH>
                <TH>Flags</TH>
              </TR>
            </THead>
            <TBody>
              {query.data?.items.map((row) => (
                <TR key={`${row.employeeId}-${row.date}`}>
                  <TD className="whitespace-nowrap">{formatDate(row.date)}</TD>
                  <TD>
                    {isHr ? (
                      <Link
                        to={`/attendance/${row.employeeId}`}
                        className="font-medium text-slate underline-offset-2 hover:text-ink hover:underline"
                      >
                        {row.firstName} {row.lastName}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">
                        {row.firstName} {row.lastName}
                      </span>
                    )}
                    <span className="block text-caption text-slate">{row.employeeCode}</span>
                  </TD>
                  <TD>{row.department}</TD>
                  <TD>
                    <StatusPill status={row.status}>
                      {row.status.replace('_', ' ')}
                    </StatusPill>
                  </TD>
                  <TD className="whitespace-nowrap">{row.firstInLocal ?? '—'}</TD>
                  <TD className="whitespace-nowrap">{row.lastOutLocal ?? '—'}</TD>
                  <TD>{hoursLabel(row.spanHours)}</TD>
                  <TD>{hoursLabel(row.netHours)}</TD>
                  <TD>{row.visits}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {row.flags.length === 0 ? (
                        <span className="text-slate">—</span>
                      ) : (
                        row.flags.map((flag) => (
                          <StatusPill
                            key={flag}
                            tone={flag === 'DUPLICATE_SUSPECT' ? 'ERROR' : 'NEUTRAL'}
                          >
                            {flag.replaceAll('_', ' ')}
                          </StatusPill>
                        ))
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={query.data?.meta.page ?? 1}
            totalPages={query.data?.meta.totalPages ?? 1}
            onPage={(page) => setFilters({ ...filters, page })}
          />
        </Card>
      )}

      {!isHr ? (
        <Card className="bg-periwinkle">
          <p className="text-body-sm text-ink">
            Looking for a staff member? Open the{' '}
            <button
              type="button"
              onClick={() => navigate('/kiosk')}
              className="font-medium text-slate underline underline-offset-2"
            >
              gate kiosk
            </button>{' '}
            to mark entry or exit.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
