import { useQuery } from '@tanstack/react-query';
import type { OnCampusResponse } from '@alche/shared';
import { apiFetch } from '../lib/api';
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusPill,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';
import { ClockIcon, MapPinIcon } from '../components/icons';
import { durationLabel, elapsedLabel, formatTime } from '../lib/dates';

export function OnCampusPage() {
  const query = useQuery<OnCampusResponse>({
    queryKey: ['on-campus'],
    queryFn: () => apiFetch<OnCampusResponse>('/on-campus'),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-16">
      <PageHeader
        title="On campus now"
        description="The screen to glance at when the gate phone rings. Read-only for both security and HR."
      />

      {query.isLoading ? (
        <Card>
          <TableSkeleton rows={6} columns={4} />
        </Card>
      ) : query.isError ? (
        <ErrorState title="The on-campus board could not load." onRetry={() => query.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Staff on campus</p>
              <p className="mt-1 text-heading-sm font-medium text-ink">
                {query.data?.employees.length ?? 0}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Guests on site</p>
              <p className="mt-1 text-heading-sm font-medium text-ink">
                {query.data?.guests.length ?? 0}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Bays occupied</p>
              <p className="mt-1 text-heading-sm font-medium text-ink">
                {query.data?.parking.occupied ?? 0} / {query.data?.parking.total ?? 0}
              </p>
              <p className="text-body-sm text-slate">{query.data?.parking.free ?? 0} free</p>
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
              title="Staff on campus"
              description="Latest effective event is IN. Time is local Mauritius time."
            />
            {query.data?.employees.length === 0 ? (
              <p className="text-body-sm text-slate">No staff are currently on campus.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Employee</TH>
                    <TH>Department</TH>
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
                      <TD>{employee.department}</TD>
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

          <Card>
            <CardHeader title="Guests on site" description="Host and expected departure are shown." />
            {query.data?.guests.length === 0 ? (
              <p className="text-body-sm text-slate">No guests are currently checked in.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Guest</TH>
                    <TH>Host</TH>
                    <TH>Checked in</TH>
                    <TH>Expected out</TH>
                    <TH>Badge</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {query.data?.guests.map((guest) => (
                    <TR key={guest.visitId}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={guest.guestName} size="sm" />
                          <span>
                            <span className="block font-medium text-ink">{guest.guestName}</span>
                            <span className="block text-caption text-slate">
                              {guest.company ?? '—'}
                            </span>
                          </span>
                        </div>
                      </TD>
                      <TD>
                        {guest.hostName}
                        <span className="block text-caption text-slate">{guest.hostDepartment}</span>
                      </TD>
                      <TD>{formatTime(guest.since)}</TD>
                      <TD>{formatTime(guest.expectedTo)}</TD>
                      <TD>{guest.badgeNo ?? '—'}</TD>
                      <TD>
                        {guest.overdue ? (
                          <StatusPill tone="OVERDUE">OVERDUE</StatusPill>
                        ) : (
                          <StatusPill tone="ON_SITE">ON SITE</StatusPill>
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
