import { useQuery } from '@tanstack/react-query';
import type { OnCampusResponse } from '@alche/shared';
import { apiFetch } from '../lib/api';
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';
import { ClockIcon } from '../components/icons';
import { elapsedLabel, formatTime } from '../lib/dates';

export function OnCampusPage() {
  const query = useQuery<OnCampusResponse>({
    queryKey: ['on-campus'],
    queryFn: () => apiFetch<OnCampusResponse>('/on-campus'),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="On campus now"
        description="Employees whose latest effective event is IN. Read-only for security and HR."
      />

      {query.isLoading ? (
        <Card>
          <TableSkeleton rows={6} columns={4} />
        </Card>
      ) : query.isError ? (
        <ErrorState title="The on-campus board could not load." onRetry={() => query.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Employees on campus</p>
              <p className="mt-1 text-heading-sm font-medium text-ink">
                {query.data?.employees.length ?? 0}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Last refreshed</p>
              <p className="mt-1 text-body font-medium text-ink">
                {query.data ? formatTime(query.data.generatedAt) : '—'}
              </p>
              <p className="text-body-sm text-slate">Refreshes every 30 seconds</p>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Employees on campus"
              description="Latest effective event is IN. Time is local Mauritius time."
            />
            {query.data?.employees.length === 0 ? (
              <p className="text-body-sm text-slate">No employees are currently on campus.</p>
            ) : (
              <Table tableClassName="min-w-[560px]">
                <THead>
                  <TR>
                    <TH>Employee</TH>
                    <TH>Since</TH>
                    <TH>Elapsed</TH>
                    <TH>Vehicles</TH>
                  </TR>
                </THead>
                <TBody>
                  {query.data?.employees.map((employee) => (
                    <TR key={employee.id}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={employee.fullName} size="sm" />
                          <span>
                            <span className="block font-medium text-ink">{employee.fullName}</span>
                            <span className="block text-caption text-slate">{employee.code}</span>
                          </span>
                        </div>
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-1">
                          <ClockIcon size={16} />
                          {formatTime(employee.since)}
                        </span>
                      </TD>
                      <TD>{elapsedLabel(employee.since)}</TD>
                      <TD>
                        {employee.vehicles.length ? (
                          <div className="flex flex-wrap gap-1">
                            {employee.vehicles.map((plate) => (
                              <Badge key={plate}>{plate}</Badge>
                            ))}
                          </div>
                        ) : (
                          '—'
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
