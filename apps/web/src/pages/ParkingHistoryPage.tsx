import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import type { ParkingArea, ParkingHistoryResponse } from '@alche/shared';
import { ApiError, apiDownload, apiFetch } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
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
import { durationLabel, formatDate } from '../lib/dates';

export function ParkingHistoryPage() {
  const toast = useToast();
  const [from, setFrom] = useState(
    DateTime.now().minus({ days: 29 }).toISODate() ?? '',
  );
  const [to, setTo] = useState(DateTime.now().toISODate() ?? '');
  const [areaId, setAreaId] = useState('');
  const [bayType, setBayType] = useState('');
  const [applied, setApplied] = useState({ from, to, areaId, bayType });

  const areas = useQuery({
    queryKey: ['parking', 'areas'],
    queryFn: () => apiFetch<{ items: ParkingArea[] }>('/parking/areas'),
  });

  const history = useQuery({
    queryKey: ['parking', 'history', applied],
    queryFn: () => {
      const params = new URLSearchParams({ from: applied.from, to: applied.to });
      if (applied.areaId) params.set('areaId', applied.areaId);
      if (applied.bayType) params.set('bayType', applied.bayType);
      return apiFetch<ParkingHistoryResponse>(`/parking/history?${params.toString()}`);
    },
  });

  const exportCsv = async () => {
    try {
      await apiDownload(
        `/parking/export.csv?from=${applied.from}&to=${applied.to}`,
        `parking_${applied.from}_${applied.to}.csv`,
      );
      toast.push({ title: 'Parking sessions exported', tone: 'success' });
    } catch (error) {
      toast.push({
        title: 'Export failed',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    }
  };

  const peak = Math.max(0, ...(history.data?.rows.map((row) => row.peakOccupancy) ?? [0]));

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Parking history"
          description="Daily peak occupancy and average dwell by area and bay type. This is the evidence for changing the reserved-bay split."
          actions={
            <Button icon={<DownloadIcon size={18} />} onClick={exportCsv}>
              Export sessions
            </Button>
          }
        />
        <Card>
          <div className="grid gap-4 md:grid-cols-4">
            <Input
              label="From"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <Select
              label="Area"
              value={areaId}
              onChange={(event) => setAreaId(event.target.value)}
              placeholder="All areas"
              options={(areas.data?.items ?? []).map((area) => ({
                value: area.id,
                label: area.name,
              }))}
            />
            <Select
              label="Bay type"
              value={bayType}
              onChange={(event) => setBayType(event.target.value)}
              placeholder="All types"
              options={[
                ['STAFF', 'Staff'],
                ['STUDENT', 'Student'],
                ['GUEST', 'Guest'],
                ['GENERAL', 'General'],
                ['ACCESSIBLE', 'Accessible'],
                ['MOTORBIKE', 'Motorbike'],
              ].map(([value, label]) => ({ value: value!, label: label! }))}
            />
            <div className="md:col-span-4">
              <Button
                icon={<RefreshIcon size={18} />}
                onClick={() => setApplied({ from, to, areaId, bayType })}
              >
                Run report
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {history.isLoading ? (
        <Card>
          <TableSkeleton rows={7} columns={6} />
        </Card>
      ) : history.isError ? (
        <ErrorState
          title="Parking history could not load."
          description={history.error instanceof ApiError ? history.error.message : undefined}
          onRetry={() => history.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Sessions</p>
              <p className="mt-1 text-heading-sm font-medium text-ink">
                {history.data?.totals.sessions ?? 0}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Average dwell</p>
              <p className="mt-1 text-heading-sm font-medium text-ink">
                {durationLabel(history.data?.totals.averageDwellMinutes ?? null)}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Peak occupancy</p>
              <p className="mt-1 text-heading-sm font-medium text-ink">{peak}</p>
            </Card>
            <Card className="p-5">
              <p className="text-caption uppercase tracking-caption text-slate">Range</p>
              <p className="mt-1 text-body font-medium text-ink">
                {formatDate(applied.from)} – {formatDate(applied.to)}
              </p>
            </Card>
          </div>

          {history.data?.rows.length === 0 ? (
            <EmptyState
              title="No parking sessions in this range."
              description="Try a wider date range or clear the area and type filters."
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Area</TH>
                    <TH>Type</TH>
                    <TH>Peak occupancy</TH>
                    <TH>Sessions started</TH>
                    <TH>Average dwell</TH>
                  </TR>
                </THead>
                <TBody>
                  {history.data?.rows.map((row) => (
                    <TR key={`${row.date}-${row.areaId}-${row.bayType}`}>
                      <TD>{formatDate(row.date)}</TD>
                      <TD>{row.areaName}</TD>
                      <TD>
                        <Badge>{row.bayType}</Badge>
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-20 overflow-hidden rounded-full-2 bg-shadow-dust">
                            <span
                              className="block h-full rounded-full-2 bg-monday-violet"
                              style={{ width: `${peak ? (row.peakOccupancy / peak) * 100 : 0}%` }}
                            />
                          </span>
                          {row.peakOccupancy}
                        </span>
                      </TD>
                      <TD>{row.sessions}</TD>
                      <TD>{durationLabel(row.averageDwellMinutes)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
          <p className="text-caption text-slate">
            Peak occupancy counts every session overlapping the day. Average dwell uses completed
            sessions that started on that day.
          </p>
        </>
      )}
    </div>
  );
}
