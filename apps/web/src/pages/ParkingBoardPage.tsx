import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActiveParkingSession,
  BayType,
  ParkingBoardResponse,
  Vehicle,
  VehicleListResponse,
} from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useDebouncedValue } from '../lib/useDebouncedValue';
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
  TableSkeleton,
  Textarea,
  useToast,
} from '../components/ui';
import { ParkingIcon, RefreshIcon, SearchIcon } from '../components/icons';
import { cn } from '../lib/cn';
import { formatTime } from '../lib/dates';

interface BayTarget {
  id: string;
  code: string;
  bayType: BayType;
  areaName: string;
}

function overrideRequired(bayType: BayType, holder: Vehicle['holder']['kind'], vehicleType: string) {
  if (bayType === 'GENERAL') return false;
  if (bayType === 'ACCESSIBLE') return true;
  if (bayType === 'MOTORBIKE') return vehicleType !== 'motorbike';
  const expected = bayType === 'STAFF' ? 'employee' : 'guest';
  return holder !== expected;
}

export function ParkingBoardPage() {
  const { user } = useAuth();
  const canOperate = user?.role === 'SECURITY';
  const queryClient = useQueryClient();
  const toast = useToast();
  const [areaFilter, setAreaFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [target, setTarget] = useState<BayTarget | 'auto' | null>(null);
  const [session, setSession] = useState<ActiveParkingSession | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const debouncedVehicleSearch = useDebouncedValue(vehicleSearch, 250);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [note, setNote] = useState('');
  const [relocating, setRelocating] = useState(false);
  const [relocateBayId, setRelocateBayId] = useState('');
  const [relocateReason, setRelocateReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const board = useQuery({
    queryKey: ['parking', 'board', areaFilter, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (areaFilter) params.set('areaId', areaFilter);
      if (typeFilter) params.set('bayType', typeFilter);
      return apiFetch<ParkingBoardResponse>(
        `/parking/board${params.size ? `?${params.toString()}` : ''}`,
      );
    },
    refetchInterval: 30_000,
  });

  const vehicleResults = useQuery({
    queryKey: ['vehicles', 'parking-picker', debouncedVehicleSearch],
    queryFn: () =>
      apiFetch<VehicleListResponse>(
        `/vehicles?q=${encodeURIComponent(debouncedVehicleSearch)}&page=1`,
      ),
    enabled: Boolean(target) && debouncedVehicleSearch.trim().length >= 2,
  });

  const freeBays = useMemo(
    () =>
      (board.data?.areas ?? []).flatMap((area) =>
        area.bays
          .filter((bay) => bay.active && !bay.session)
          .map((bay) => ({
            id: bay.id,
            code: bay.code,
            bayType: bay.bayType,
            areaName: area.name,
          })),
      ),
    [board.data],
  );

  const closeAllocate = () => {
    setTarget(null);
    setSelectedVehicle(null);
    setVehicleSearch('');
    setOverrideReason('');
    setNote('');
    setFieldErrors({});
  };

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['parking'] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
      queryClient.invalidateQueries({ queryKey: ['guest-visits'] }),
    ]);
  };

  const allocate = useMutation({
    mutationFn: () => {
      if (!selectedVehicle) throw new Error('Choose a vehicle');
      const explicit = target !== 'auto' && target;
      return apiFetch<{ session: ActiveParkingSession }>('/parking/sessions', {
        method: 'POST',
        body: {
          vehicleId: selectedVehicle.id,
          ...(explicit ? { bayId: explicit.id } : { autoAssign: true }),
          ...(overrideReason ? { overrideReason } : {}),
          ...(note ? { note } : {}),
        },
      });
    },
    onSuccess: async (data) => {
      toast.push({
        title: 'Bay allocated',
        message: `${data.session.plate} is in ${data.session.bayCode}, ${data.session.areaName}.`,
        tone: 'success',
      });
      closeAllocate();
      await refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Could not allocate the bay',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const release = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/parking/sessions/${sessionId}/release`, {
        method: 'POST',
        body: { reason: 'Released from parking board' },
      }),
    onSuccess: async () => {
      toast.push({ title: 'Bay released', tone: 'success' });
      setSession(null);
      await refresh();
    },
    onError: (error) => {
      toast.push({
        title: 'Could not release the bay',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const relocate = useMutation({
    mutationFn: () => {
      if (!session) throw new Error('No session');
      return apiFetch<{ session: ActiveParkingSession }>(
        `/parking/sessions/${session.id}/relocate`,
        {
          method: 'POST',
          body: {
            bayId: relocateBayId,
            ...(relocateReason ? { overrideReason: relocateReason } : {}),
          },
        },
      );
    },
    onSuccess: async (data) => {
      toast.push({
        title: 'Vehicle relocated',
        message: `Moved to ${data.session.bayCode}, ${data.session.areaName}.`,
        tone: 'success',
      });
      setSession(null);
      setRelocating(false);
      setRelocateBayId('');
      setRelocateReason('');
      await refresh();
    },
    onError: (error) => {
      toast.push({
        title: 'Could not relocate the vehicle',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const selectedBay = target !== 'auto' ? target : null;
  const needsOverride =
    selectedVehicle && selectedBay
      ? overrideRequired(
          selectedBay.bayType,
          selectedVehicle.holder.kind,
          selectedVehicle.vehicleType,
        )
      : false;
  const relocateTarget = freeBays.find((bay) => bay.id === relocateBayId);
  const relocateNeedsOverride =
    session && relocateTarget
      ? overrideRequired(relocateTarget.bayType, session.holderCategory, session.vehicleType)
      : false;

  const counts = board.data?.counts;
  const typeLabels = new Map((board.data?.legend ?? []).map((item) => [item.type, item.label]));

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="Parking board"
          description={
            canOperate
              ? 'Live bay occupancy. Click a free bay to allocate, or an occupied bay to release or relocate.'
              : 'Live bay occupancy, read-only for HR accounts.'
          }
          actions={
            canOperate ? (
              <>
                <Button variant="outlined" icon={<RefreshIcon size={18} />} onClick={() => board.refetch()}>
                  Refresh
                </Button>
                <Button
                  icon={<ParkingIcon size={18} />}
                  onClick={() => {
                    setTarget('auto');
                    setSelectedVehicle(null);
                    setVehicleSearch('');
                    setOverrideReason('');
                    setNote('');
                  }}
                >
                  Auto-assign
                </Button>
              </>
            ) : undefined
          }
        />

        <Card>
          <div className="flex flex-wrap items-end gap-4">
            <Select
              label="Area"
              value={areaFilter}
              onChange={(event) => setAreaFilter(event.target.value)}
              placeholder="All areas"
              options={(board.data?.areas ?? []).map((area) => ({
                value: area.id,
                label: area.name,
              }))}
              className="max-w-xs"
            />
            <Select
              label="Bay type"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              placeholder="All types"
              options={[
                ['STAFF', 'Staff'],
                ['GUEST', 'Guest'],
                ['GENERAL', 'General'],
                ['ACCESSIBLE', 'Accessible'],
                ['MOTORBIKE', 'Motorbike'],
              ].map(([value, label]) => ({ value: value!, label: label! }))}
              className="max-w-xs"
            />
          </div>
        </Card>
      </div>

      {board.isLoading ? (
        <Card>
          <TableSkeleton rows={6} columns={6} />
        </Card>
      ) : board.isError ? (
        <ErrorState
          title="The parking board could not load."
          description={board.error instanceof ApiError ? board.error.message : undefined}
          onRetry={() => board.refetch()}
        />
      ) : board.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <p className="text-caption font-medium uppercase tracking-caption text-slate">Capacity</p>
              <p className="mt-1 text-heading-sm font-medium text-ink">
                {counts?.overall.occupied ?? 0} / {counts?.overall.total ?? 0}
              </p>
              <p className="text-body-sm text-slate">{counts?.overall.free ?? 0} bays free</p>
            </Card>
            {Object.entries(counts?.byType ?? {}).map(([type, value]) => (
              <Card key={type} className="p-5">
                <p className="text-caption font-medium uppercase tracking-caption text-slate">
                  {typeLabels.get(type as BayType) ?? type}
                </p>
                <p className="mt-1 text-heading-sm font-medium text-ink">
                  {value.free} free <span className="text-body-sm text-slate">of {value.total}</span>
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full-2 bg-shadow-dust">
                  <div
                    className="h-full rounded-full-2 bg-monday-violet"
                    style={{ width: `${value.total ? (value.occupied / value.total) * 100 : 0}%` }}
                  />
                </div>
              </Card>
            ))}
          </div>

          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              {board.data.legend.map((item) => (
                <span
                  key={item.type}
                  className="inline-flex items-center gap-2 rounded-md bg-snow px-2 py-1 text-caption text-slate"
                >
                  <span className="inline-flex h-6 min-w-8 items-center justify-center rounded-md bg-periwinkle-wash px-1 text-caption font-medium text-ink">
                    {item.chip}
                  </span>
                  {item.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-2 rounded-md bg-snow px-2 py-1 text-caption text-slate">
                <span className="h-3 w-3 rounded-sm bg-mint" /> Free
              </span>
              <span className="inline-flex items-center gap-2 rounded-md bg-snow px-2 py-1 text-caption text-slate">
                <span className="h-3 w-3 rounded-sm bg-aqua" /> Occupied
              </span>
              <span className="inline-flex items-center gap-2 rounded-md bg-snow px-2 py-1 text-caption text-slate">
                <span className="h-3 w-3 rounded-sm bg-shadow-dust" /> Inactive
              </span>
            </div>

            {board.data.areas.length === 0 || board.data.areas.every((area) => area.bays.length === 0) ? (
              <EmptyState
                title="No bays match these filters."
                description="Create bays in the inventory, or widen the area and type filters."
              />
            ) : (
              <div className="space-y-6">
                {board.data.areas.map((area) => (
                  <section key={area.id} aria-labelledby={`area-${area.id}`}>
                    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h2 id={`area-${area.id}`} className="text-subheading font-medium text-ink">
                          {area.name}
                        </h2>
                        <p className="text-body-sm text-slate">
                          {area.counts.overall.occupied} occupied · {area.counts.overall.free} free ·{' '}
                          {area.counts.overall.total} active
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(area.counts.byType).map(([type, value]) => (
                          <Badge key={type}>
                            {typeLabels.get(type as BayType) ?? type}: {value.free}/{value.total} free
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                      {area.bays.map((bay) => {
                        const occupied = Boolean(bay.session);
                        const interactive = bay.active && (occupied || canOperate);
                        return (
                          <button
                            key={bay.id}
                            type="button"
                            disabled={!interactive}
                            aria-label={`${bay.code}, ${typeLabels.get(bay.bayType) ?? bay.bayType} bay, ${
                              !bay.active ? 'inactive' : occupied ? 'occupied' : 'free'
                            }`}
                            onClick={() => {
                              if (occupied && bay.session) setSession(bay.session);
                              else if (!occupied && canOperate)
                                setTarget({
                                  id: bay.id,
                                  code: bay.code,
                                  bayType: bay.bayType,
                                  areaName: area.name,
                                });
                            }}
                            className={cn(
                              'flex min-h-[68px] flex-col items-start justify-between rounded-md p-3 text-left text-[13px] transition-opacity',
                              !bay.active
                                ? 'cursor-default bg-shadow-dust text-slate'
                                : occupied
                                  ? 'bg-aqua text-ink hover:opacity-90'
                                  : 'bg-mint text-forest hover:opacity-90',
                              !interactive && 'cursor-default',
                            )}
                          >
                            <span className="flex w-full items-center justify-between gap-1">
                              <span className="font-medium">{bay.code}</span>
                              <span className="rounded-md bg-snow/70 px-1 font-medium">{bay.chip}</span>
                            </span>
                            <span className="w-full truncate text-caption">
                              {!bay.active ? 'Inactive' : occupied ? bay.session!.plate : 'Free'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      <Modal
        open={Boolean(target)}
        onClose={closeAllocate}
        title={target === 'auto' ? 'Auto-assign a bay' : `Allocate ${selectedBay?.code ?? ''}`}
        description={
          target === 'auto'
            ? 'The server chooses the lowest free matching bay, then a GENERAL bay.'
            : `${selectedBay?.areaName ?? ''} · ${selectedBay?.bayType.toLowerCase() ?? ''} bay`
        }
        size="lg"
        footer={
          <>
            <Button variant="outlined" onClick={closeAllocate}>
              Cancel
            </Button>
            <Button
              loading={allocate.isPending}
              disabled={
                !selectedVehicle ||
                (Boolean(needsOverride) && overrideReason.trim().length < 3)
              }
              onClick={() => {
                setFieldErrors({});
                allocate.mutate();
              }}
            >
              Allocate
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Find vehicle or holder"
            value={vehicleSearch}
            onChange={(event) => {
              setVehicleSearch(event.target.value);
              setSelectedVehicle(null);
            }}
            placeholder="Plate, name, code"
            suffix={<SearchIcon size={20} />}
            error={fieldErrors.vehicleId}
            autoFocus
          />
          {debouncedVehicleSearch.trim().length >= 2 && !selectedVehicle ? (
            <div className="max-h-56 overflow-y-auto rounded-md border border-mist">
              {vehicleResults.isLoading ? (
                <p className="p-3 text-body-sm text-slate">Searching…</p>
              ) : vehicleResults.data?.items.length ? (
                vehicleResults.data.items.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-mist px-3 text-left last:border-0 hover:bg-cloud"
                    onClick={() => {
                      setSelectedVehicle(vehicle);
                      setVehicleSearch(`${vehicle.plate} · ${vehicle.holder.name}`);
                    }}
                  >
                    <span>
                      <span className="block text-body-sm font-medium text-ink">{vehicle.plate}</span>
                      <span className="block text-caption text-slate">
                        {vehicle.holder.name} · {vehicle.holder.kind} · {vehicle.vehicleType}
                      </span>
                    </span>
                    {vehicle.activeParking ? (
                      <StatusPill tone="ON_SITE">PARKED {vehicle.activeParking.bayCode}</StatusPill>
                    ) : (
                      <StatusPill tone="PRESENT">NOT PARKED</StatusPill>
                    )}
                  </button>
                ))
              ) : (
                <p className="p-3 text-body-sm text-slate">No matching vehicle.</p>
              )}
            </div>
          ) : null}

          {selectedVehicle ? (
            <div className="rounded-md bg-cloud px-3 py-2 text-body-sm text-ink">
              {selectedVehicle.plate} · {selectedVehicle.holder.name} · {selectedVehicle.holder.kind}
            </div>
          ) : null}

          {needsOverride ? (
            <Textarea
              label="Override reason"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              hint="This bay does not match the holder's category. A typed reason is required and audited."
              error={fieldErrors.overrideReason}
              required
            />
          ) : null}
          <Textarea
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Optional operational note stored with the session."
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(session)}
        onClose={() => {
          setSession(null);
          setRelocating(false);
        }}
        title={session ? `Bay ${session.bayCode}` : 'Parking session'}
        description={session ? `${session.areaName} · ${session.holderCategory}` : undefined}
        size="lg"
      >
        {session ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="ON_SITE">OCCUPIED</StatusPill>
              {session.isOverride ? <StatusPill tone="ERROR">OVERRIDE</StatusPill> : null}
              <Badge>{session.holderCategory}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-cloud p-3">
                <p className="text-caption text-slate">Vehicle</p>
                <p className="text-body font-medium text-ink">{session.plate}</p>
                <p className="text-body-sm text-slate">{session.holderName}</p>
              </div>
              <div className="rounded-md bg-cloud p-3">
                <p className="text-caption text-slate">Started</p>
                <p className="text-body font-medium text-ink">{formatTime(session.startedAt)}</p>
                <p className="text-body-sm text-slate">by {session.allocatedBy}</p>
              </div>
            </div>
            {session.overrideReason ? (
              <p className="rounded-md bg-error-surface px-3 py-2 text-body-sm text-error-ink">
                Override: {session.overrideReason}
              </p>
            ) : null}
            {session.note ? <p className="text-body-sm text-slate">Note: {session.note}</p> : null}

            {relocating ? (
              <div className="space-y-3 rounded-md border border-mist p-3">
                <Select
                  label="Move to bay"
                  value={relocateBayId}
                  onChange={(event) => setRelocateBayId(event.target.value)}
                  placeholder="Choose a free bay"
                  options={freeBays
                    .filter((bay) => bay.id !== session.bayId)
                    .map((bay) => ({
                      value: bay.id,
                      label: `${bay.code} · ${bay.bayType} · ${bay.areaName}`,
                    }))}
                />
                {relocateNeedsOverride ? (
                  <Textarea
                    label="Override reason"
                    value={relocateReason}
                    onChange={(event) => setRelocateReason(event.target.value)}
                    required
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    loading={relocate.isPending}
                    disabled={!relocateBayId || (relocateNeedsOverride && relocateReason.trim().length < 3)}
                    onClick={() => relocate.mutate()}
                  >
                    Move vehicle
                  </Button>
                  <Button variant="outlined" onClick={() => setRelocating(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {canOperate ? (
                  <>
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setRelocating(true);
                        setRelocateBayId('');
                        setRelocateReason('');
                      }}
                    >
                      Relocate
                    </Button>
                    <Button
                      loading={release.isPending}
                      onClick={() => release.mutate(session.id)}
                    >
                      Release bay
                    </Button>
                  </>
                ) : (
                  <p className="text-body-sm text-slate">
                    HR accounts can view the board but cannot release or relocate vehicles.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
