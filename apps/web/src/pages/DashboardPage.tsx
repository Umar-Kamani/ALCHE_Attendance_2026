import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardStats } from '@alche/shared';
import { apiFetch } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Input,
  PageHeader,
  StatusPill,
  TableSkeleton,
} from '../components/ui';
import { RefreshIcon } from '../components/icons';
import { formatDateShort, hoursLabel } from '../lib/dates';

const TREND_LEGEND = [
  { key: 'present', label: 'Present', className: 'bg-mint' },
  { key: 'onSite', label: 'On site', className: 'bg-aqua' },
  { key: 'missingIn', label: 'Missing IN', className: 'bg-error-surface' },
  { key: 'absent', label: 'Absent', className: 'bg-shadow-dust' },
] as const;

export function DashboardPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' });

  const query = useQuery({
    queryKey: ['dashboard', applied],
    queryFn: () => {
      const params = new URLSearchParams();
      if (applied.from) params.set('from', applied.from);
      if (applied.to) params.set('to', applied.to);
      return apiFetch<DashboardStats>(
        `/dashboard/stats${params.size ? `?${params.toString()}` : ''}`,
      );
    },
    refetchInterval: 60_000,
  });

  const maxTrend = Math.max(
    1,
    ...(query.data?.trend.map(
      (day) => day.present + day.onSite + day.missingIn + day.absent,
    ) ?? [1]),
  );

  return (
    <div className="space-y-16">
      <PageHeader
        title="Campus dashboard"
        description="Aggregate employee attendance statistics. This read-only view contains no individual names or personal data."
        actions={
          <Button
            variant="outlined"
            icon={<RefreshIcon size={18} />}
            onClick={() => query.refetch()}
          >
            Refresh
          </Button>
        }
      />

      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <Input
            label="Trend from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label="Trend to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <div className="flex items-end gap-2">
            <Button onClick={() => setApplied({ from, to })}>Apply range</Button>
            <Button
              variant="outlined"
              onClick={() => {
                setFrom('');
                setTo('');
                setApplied({ from: '', to: '' });
              }}
            >
              Last 30 days
            </Button>
          </div>
        </div>
      </Card>

      {query.isLoading ? (
        <Card>
          <TableSkeleton rows={6} columns={4} />
        </Card>
      ) : query.isError ? (
        <ErrorState title="Dashboard stats could not load." onRetry={() => query.refetch()} />
      ) : query.data ? (
        <>
          <section aria-labelledby="today-snapshot">
            <h2 id="today-snapshot" className="mb-3 text-subheading font-medium text-ink">
              Today’s snapshot · {query.data.today}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ['Present', query.data.attendance.present, 'PRESENT'],
                ['On site', query.data.attendance.onSite, 'ON_SITE'],
                ['Missing IN', query.data.attendance.missingIn, 'MISSING_IN'],
                ['Absent', query.data.attendance.absent, 'ABSENT'],
                ['On campus now', query.data.attendance.onCampusNow, 'ON_SITE'],
              ].map(([label, value, status]) => (
                <Card key={String(label)} className="p-5">
                  <p className="text-caption font-medium uppercase tracking-caption text-slate">
                    {label}
                  </p>
                  <p className="mt-1 text-heading-sm font-medium text-ink">{value}</p>
                  <StatusPill status={String(status)} className="mt-2">
                    {String(label)}
                  </StatusPill>
                </Card>
              ))}
            </div>
          </section>

          <section aria-labelledby="month-summary">
            <h2 id="month-summary" className="mb-3 text-subheading font-medium text-ink">
              Current month
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Card className="p-5">
                <p className="text-caption uppercase tracking-caption text-slate">Present days</p>
                <p className="mt-1 text-heading-sm font-medium text-ink">{query.data.month.present}</p>
              </Card>
              <Card className="p-5">
                <p className="text-caption uppercase tracking-caption text-slate">On-site days</p>
                <p className="mt-1 text-heading-sm font-medium text-ink">{query.data.month.onSite}</p>
              </Card>
              <Card className="p-5">
                <p className="text-caption uppercase tracking-caption text-slate">Missing IN</p>
                <p className="mt-1 text-heading-sm font-medium text-ink">
                  {query.data.month.missingIn}
                </p>
              </Card>
              <Card className="p-5">
                <p className="text-caption uppercase tracking-caption text-slate">Absent</p>
                <p className="mt-1 text-heading-sm font-medium text-ink">{query.data.month.absent}</p>
              </Card>
              <Card className="p-5">
                <p className="text-caption uppercase tracking-caption text-slate">Average span</p>
                <p className="mt-1 text-heading-sm font-medium text-ink">
                  {hoursLabel(query.data.month.averageSpanHours)}
                </p>
              </Card>
            </div>
          </section>

          <section aria-labelledby="trend-heading">
            <Card>
              <CardHeader
                title="Attendance trend"
                description={`${formatDateShort(query.data.range.from)} – ${formatDateShort(query.data.range.to)}`}
              />
              <div className="mb-3 flex flex-wrap gap-3">
                {TREND_LEGEND.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-2 text-caption text-slate">
                    <span className={`h-3 w-3 rounded-sm ${item.className}`} />
                    {item.label}
                  </span>
                ))}
              </div>
              <div
                className="alche-scrollbar flex h-44 items-end gap-1 overflow-x-auto border-b border-mist pb-1"
                role="img"
                aria-label="Stacked bar chart of daily attendance status counts"
              >
                {query.data.trend.map((day) => {
                  const total = day.present + day.onSite + day.missingIn + day.absent;
                  return (
                    <div
                      key={day.date}
                      className="flex h-full min-w-[12px] flex-1 flex-col justify-end"
                      title={`${day.date}: ${day.present} present, ${day.onSite} on site, ${day.missingIn} missing IN, ${day.absent} absent`}
                      aria-label={`${day.date}: ${day.present} present, ${day.onSite} on site, ${day.missingIn} missing IN, ${day.absent} absent`}
                    >
                      {TREND_LEGEND.map((item) => {
                        const value = day[item.key];
                        return (
                          <span
                            key={item.key}
                            className={`block w-full ${item.className}`}
                            style={{ height: `${(value / maxTrend) * 100}%` }}
                          />
                        );
                      })}
                      <span className="sr-only">{total} staff records</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-caption text-slate">
                <span>{formatDateShort(query.data.range.from)}</span>
                <span>{query.data.trend.length} days</span>
                <span>{formatDateShort(query.data.range.to)}</span>
              </div>
            </Card>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Badge>Read only</Badge>
            <p className="text-caption text-slate">
              Generated {query.data.generatedAt}. Counts are aggregate; no personal data is exposed.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
