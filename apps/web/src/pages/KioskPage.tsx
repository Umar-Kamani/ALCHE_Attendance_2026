import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateEventResponse,
  KioskActivityResponse,
  KioskEmployeeResult,
  KioskGuestResult,
  KioskSearchResponse,
  KioskStudentResult,
  ParkingBoardResponse,
} from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { formatTime, todayLocal } from '../lib/dates';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Select,
  Skeleton,
  StatusPill,
  useToast,
} from '../components/ui';
import {
  ArrowRightIcon,
  CarIcon,
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  SearchIcon,
} from '../components/icons';
import { cn } from '../lib/cn';

type SearchResult = KioskEmployeeResult | KioskStudentResult | KioskGuestResult;

interface SelectedParking {
  sessionId: string;
  bayId: string;
  bayCode: string;
  areaName: string;
}

function bayNumber(code: string): number {
  const match = code.match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function suggestedBay(board: ParkingBoardResponse | undefined, vehicleType: string) {
  if (!board) return null;
  const preferred = vehicleType === 'motorbike' ? 'MOTORBIKE' : 'STAFF';
  const candidates = board.areas
    .flatMap((area) =>
      area.bays.map((bay) => ({
        id: bay.id,
        code: bay.code,
        bayType: bay.bayType,
        areaName: area.name,
        areaId: area.id,
        session: bay.session,
      })),
    )
    .filter((bay) => !bay.session)
    .filter((bay) => bay.bayType === preferred || bay.bayType === 'GENERAL')
    .sort((a, b) => {
      if (a.bayType === preferred && b.bayType !== preferred) return -1;
      if (b.bayType === preferred && a.bayType !== preferred) return 1;
      return bayNumber(a.code) - bayNumber(b.code);
    });
  return candidates[0] ?? null;
}

function resultLabel(result: SearchResult): string {
  if (result.kind === 'employee') return result.code;
  if (result.kind === 'student') return result.studentId;
  return result.company ?? 'Guest';
}

export function KioskPage() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [directionOverride, setDirectionOverride] = useState<'IN' | 'OUT' | null>(null);
  const [parkingChoice, setParkingChoice] = useState<'auto' | 'none'>('auto');
  const [formError, setFormError] = useState<string | null>(null);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    plate: '',
    make: '',
    model: '',
    colour: '',
    vehicleType: 'car' as 'car' | 'motorbike' | 'van' | 'other',
  });
  const [vehicleFieldErrors, setVehicleFieldErrors] = useState<Record<string, string[]>>({});
  const { user } = useAuth();
  const canPark = user?.role === 'SECURITY';
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const search = useQuery({
    queryKey: ['kiosk', 'search', debouncedQuery],
    queryFn: () =>
      apiFetch<KioskSearchResponse>(
        `/kiosk/search?q=${encodeURIComponent(debouncedQuery.trim())}`,
      ),
    enabled: debouncedQuery.trim().length > 0,
    staleTime: 5_000,
  });

  const activity = useQuery({
    queryKey: ['kiosk', 'activity'],
    queryFn: () => apiFetch<KioskActivityResponse>('/kiosk/activity'),
    refetchInterval: 30_000,
  });

  const board = useQuery({
    queryKey: ['parking', 'board', 'kiosk'],
    queryFn: () => apiFetch<ParkingBoardResponse>('/parking/board'),
    enabled: selected?.kind === 'employee',
    staleTime: 10_000,
  });

  const results = useMemo<SearchResult[]>(() => {
    if (!search.data) return [];
    return [...search.data.employees, ...search.data.students, ...search.data.guests];
  }, [search.data]);

  useEffect(() => {
    setActiveIndex(0);
  }, [search.data]);

  useEffect(() => {
    if (!selected || !search.data) return;
    const fresh = results.find((result) => result.kind === selected.kind && result.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [results, selected?.id, selected?.kind]);

  const employee = selected?.kind === 'employee' ? selected : null;
  const inferredDirection: 'IN' | 'OUT' = employee?.currentState.onCampus ? 'OUT' : 'IN';
  const direction = directionOverride ?? inferredDirection;
  const vehicle = employee?.vehicles[0] ?? null;
  const freeBay = suggestedBay(board.data, vehicle?.vehicleType ?? 'car');
  const canOfferParking =
    canPark && direction === 'IN' && Boolean(vehicle) && !vehicle?.activeParking && Boolean(freeBay);
  const chosenBay = canOfferParking && parkingChoice === 'auto' ? freeBay : null;

  const record = useMutation({
    mutationFn: async () => {
      if (!employee) throw new Error('Choose a person first.');
      setFormError(null);
      const eventResult = await apiFetch<CreateEventResponse>('/events', {
        method: 'POST',
        body: {
          employeeId: employee.id,
          direction,
        },
      });

      let parkingError: string | null = null;
      if (direction === 'IN' && chosenBay && vehicle) {
        try {
          await apiFetch('/parking/sessions', {
            method: 'POST',
            body: { vehicleId: vehicle.id, bayId: chosenBay.id },
          });
        } catch (error) {
          parkingError =
            error instanceof ApiError
              ? error.message
              : 'Attendance was saved, but the parking bay could not be allocated.';
        }
      }
      return { eventResult, parkingError };
    },
    onSuccess: async ({ eventResult, parkingError }) => {
      setFormError(parkingError);
      setSelected((current) => {
        if (!current || current.kind !== 'employee') return current;
        return {
          ...current,
          currentState: {
            onCampus: direction === 'IN',
            since: direction === 'IN' ? eventResult.event.occurredAt : null,
            lastDirection: direction,
            lastOccurredAt: eventResult.event.occurredAt,
          },
          vehicles: chosenBay
            ? current.vehicles.map((item) =>
                item.id === vehicle?.id
                  ? {
                      ...item,
                      activeParking: {
                        sessionId: 'pending',
                        bayId: chosenBay.id,
                        bayCode: chosenBay.code,
                        areaName: chosenBay.areaName,
                        startedAt: eventResult.event.occurredAt,
                      },
                    }
                  : item,
              )
            : current.vehicles,
        };
      });

      if (parkingError) {
        toast.push({
          title: `${employee!.fullName} marked ${direction}`,
          message: parkingError,
          tone: 'error',
          duration: 8_000,
        });
      } else if (direction === 'IN' && chosenBay) {
        toast.push({
          title: `${employee!.fullName} is on campus`,
          message: `Parked in ${chosenBay.code}, ${chosenBay.areaName}.`,
          tone: 'success',
          action:
            eventResult.undoUntil && eventResult.event.id
              ? {
                  label: 'Undo this entry',
                  onClick: () => undo.mutate(eventResult.event.id),
                }
              : undefined,
        });
      } else {
        const active = vehicle?.activeParking;
        toast.push({
          title: `${employee!.fullName} marked ${direction}`,
          message:
            direction === 'OUT'
              ? 'The bay remains occupied until it is released.'
              : 'Attendance recorded.',
          tone: 'success',
          action:
            direction === 'OUT' && active && canPark
              ? {
                  label: `Release bay ${active.bayCode}`,
                  onClick: () => release.mutate(active.sessionId),
                }
              : eventResult.undoUntil
                ? {
                    label: 'Undo this entry',
                    onClick: () => undo.mutate(eventResult.event.id),
                  }
                : undefined,
        });
      }

      setDirectionOverride(null);
      setParkingChoice('auto');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
        queryClient.invalidateQueries({ queryKey: ['parking'] }),
      ]);
      const refreshed = await search.refetch();
      const next = refreshed.data
        ? [...refreshed.data.employees, ...refreshed.data.students, ...refreshed.data.guests].find(
            (item) => item.kind === employee!.kind && item.id === employee!.id,
          )
        : null;
      if (next) setSelected(next);
      searchRef.current?.focus();
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : 'Could not save that attendance event.';
      setFormError(message);
      toast.push({ title: 'Not recorded', message, tone: 'error', duration: 8_000 });
    },
  });

  const undo = useMutation({
    mutationFn: (eventId: string) =>
      apiFetch<{ success: true; message: string }>(`/events/${eventId}`, {
        method: 'DELETE',
      }),
    onSuccess: async (data) => {
      toast.push({ title: 'Entry undone', message: data.message, tone: 'success' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
        queryClient.invalidateQueries({ queryKey: ['parking'] }),
      ]);
      await search.refetch();
    },
    onError: (error) => {
      toast.push({
        title: 'Could not undo',
        message: error instanceof ApiError ? error.message : 'The undo window may have closed.',
        tone: 'error',
      });
    },
  });

  const addVehicle = useMutation({
    mutationFn: () =>
      apiFetch('/vehicles', {
        method: 'POST',
        body: {
          plate: vehicleForm.plate,
          make: vehicleForm.make || null,
          model: vehicleForm.model || null,
          colour: vehicleForm.colour || null,
          vehicleType: vehicleForm.vehicleType,
          holderKind: 'employee',
          holderId: employee!.id,
        },
      }),
    onSuccess: async () => {
      toast.push({ title: 'Vehicle added', message: vehicleForm.plate, tone: 'success' });
      setVehicleOpen(false);
      setVehicleForm({ plate: '', make: '', model: '', colour: '', vehicleType: 'car' });
      setVehicleFieldErrors({});
      const refreshed = await search.refetch();
      const next = refreshed.data?.employees.find((item) => item.id === employee!.id);
      if (next) setSelected(next);
      await queryClient.invalidateQueries({ queryKey: ['parking'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) setVehicleFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Vehicle could not be added',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const release = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/parking/sessions/${sessionId}/release`, {
        method: 'POST',
        body: { reason: 'Released from kiosk after staff checkout' },
      }),
    onSuccess: async () => {
      toast.push({ title: 'Bay released', message: 'The bay is free again.', tone: 'success' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['parking'] }),
        queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
      ]);
    },
    onError: (error) => {
      toast.push({
        title: 'Could not release the bay',
        message: error instanceof ApiError ? error.message : 'Try again from the parking board.',
        tone: 'error',
      });
    },
  });

  const choose = (result: SearchResult) => {
    setSelected(result);
    setDirectionOverride(null);
    setParkingChoice('auto');
    setFormError(null);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]!);
    } else if (event.key === 'Escape') {
      setQuery('');
      setSelected(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-heading-sm font-medium tracking-heading-sm text-ink">Gate kiosk</h1>
          <p className="mt-1 text-body-sm text-slate">
            Search a name, staff number or number plate. One action follows.
          </p>
        </div>
        <div
          className="rounded-3xl border border-mist bg-snow px-4 py-2 shadow-xl"
          data-testid="on-campus-count"
        >
          <p className="text-caption text-slate">Currently on campus</p>
          <p className="text-subheading font-medium text-ink">{activity.data?.onCampusCount ?? '—'}</p>
        </div>
      </div>

      <div>
        <div className="relative">
          <Input
            ref={searchRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Start typing a name, code or plate…"
            aria-label="Search people and vehicles"
            role="combobox"
            aria-expanded={Boolean(query && results.length > 0)}
            aria-controls="kiosk-results"
            aria-activedescendant={
              results[activeIndex] ? `kiosk-result-${results[activeIndex]!.kind}-${results[activeIndex]!.id}` : undefined
            }
            className="h-16 border-mist bg-snow pl-4 pr-14 text-[20px]"
            suffix={<SearchIcon size={24} />}
          />
        </div>

        {debouncedQuery.trim() ? (
          <div
            id="kiosk-results"
            role="listbox"
            className="mt-2 overflow-hidden rounded-3xl border border-mist bg-snow shadow-xl"
          >
            {search.isLoading ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-2/3" />
              </div>
            ) : search.isError ? (
              <div className="p-4">
                <p className="text-body-sm text-error-ink">Search is unavailable. Try again.</p>
              </div>
            ) : results.length === 0 ? (
              <p className="p-4 text-body-sm text-slate">No matching person or vehicle.</p>
            ) : (
              <div className="divide-y divide-mist">
                {(['employee', 'student', 'guest'] as const).map((kind) => {
                  const group = results.filter((result) => result.kind === kind);
                  if (group.length === 0) return null;
                  return (
                    <div key={kind} className="p-2">
                      <p className="px-3 pb-1 pt-2 text-caption font-medium uppercase tracking-caption text-slate">
                        {kind === 'employee' ? 'Staff' : kind === 'student' ? 'Students' : 'Guests'}
                      </p>
                      {group.map((result) => {
                        const globalIndex = results.indexOf(result);
                        const isActive = globalIndex === activeIndex;
                        return (
                          <button
                            key={`${result.kind}-${result.id}`}
                            id={`kiosk-result-${result.kind}-${result.id}`}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActiveIndex(globalIndex)}
                            onClick={() => choose(result)}
                            className={cn(
                              'flex min-h-[60px] w-full items-center gap-3 rounded-md px-3 text-left transition-colors',
                              isActive ? 'bg-periwinkle' : 'hover:bg-cloud',
                            )}
                          >
                            <Avatar name={result.fullName} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-body-sm font-medium text-ink">
                                {result.fullName}
                              </span>
                              <span className="block truncate text-caption text-slate">
                                {resultLabel(result)}
                                {result.kind === 'employee' ? ` · ${result.department}` : ''}
                                {result.kind === 'student' && result.programme
                                  ? ` · ${result.programme}`
                                  : ''}
                              </span>
                            </span>
                            {result.kind === 'employee' ? (
                              <StatusPill
                                tone={result.currentState.onCampus ? 'ON_SITE' : 'INACTIVE'}
                              >
                                {result.currentState.onCampus ? 'ON CAMPUS' : 'OFF CAMPUS'}
                              </StatusPill>
                            ) : (
                              <StatusPill tone="NEUTRAL">{result.kind.toUpperCase()}</StatusPill>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {selected ? (
        <Card className="alche-rise" aria-live="polite">
          <div className="flex flex-wrap items-start gap-4">
            <Avatar name={selected.fullName} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-subheading font-medium tracking-subheading text-ink">
                  {selected.fullName}
                </h2>
                {selected.kind === 'employee' ? (
                  <StatusPill tone={selected.currentState.onCampus ? 'ON_SITE' : 'INACTIVE'}>
                    {selected.currentState.onCampus ? 'ON CAMPUS' : 'OFF CAMPUS'}
                  </StatusPill>
                ) : (
                  <StatusPill tone="NEUTRAL">
                    {selected.kind === 'student' ? 'STUDENT' : 'GUEST'}
                  </StatusPill>
                )}
              </div>
              <p className="mt-1 text-body-sm text-slate">
                {selected.kind === 'employee'
                  ? `${selected.code} · ${selected.department}`
                  : selected.kind === 'student'
                    ? `${selected.studentId}${selected.programme ? ` · ${selected.programme}` : ''}`
                    : (selected.company ?? 'Guest visit')}
              </p>

              {selected.kind === 'employee' ? (
                <p className="mt-3 text-body text-ink">
                  {selected.currentState.onCampus && selected.currentState.since
                    ? `On campus since ${formatTime(selected.currentState.since)}`
                    : selected.currentState.lastOccurredAt
                      ? `Off campus, last left ${formatTime(selected.currentState.lastOccurredAt)}`
                      : 'No attendance recorded yet.'}
                </p>
              ) : (
                <p className="mt-3 text-body-sm text-slate">
                  {selected.kind === 'student'
                    ? 'Students do not have attendance records. Use the parking board to allocate a bay.'
                    : 'Guests are checked in from the Guest register so the host and visit are recorded.'}
                </p>
              )}
            </div>
          </div>

          {selected.kind === 'employee' ? (
            <>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {selected.vehicles.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-2 rounded-md bg-cloud px-3 py-2 text-body-sm text-ink"
                  >
                    <CarIcon size={17} />
                    <span className="font-medium">{item.plate}</span>
                    <span className="text-slate">
                      {[item.make, item.model, item.colour].filter(Boolean).join(' · ') || 'Vehicle'}
                    </span>
                    {item.activeParking ? (
                      <StatusPill tone="ON_SITE">PARKED {item.activeParking.bayCode}</StatusPill>
                    ) : null}
                  </span>
                ))}
                <Button variant="text" size="sm" onClick={() => setVehicleOpen(true)}>
                  Add vehicle
                </Button>
              </div>

              {canPark && direction === 'IN' && vehicle && !vehicle.activeParking ? (
                <fieldset className="mt-5 rounded-3xl bg-cloud p-4">
                  <legend className="px-1 text-body-sm font-medium text-ink">
                    Parking for {vehicle.plate}
                  </legend>
                  {freeBay ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-mist bg-snow px-3">
                        <input
                          type="radio"
                          name="parking"
                          checked={parkingChoice === 'auto'}
                          onChange={() => setParkingChoice('auto')}
                        />
                        <span className="text-body-sm text-ink">
                          Park in <strong>{freeBay.code}</strong> · {freeBay.areaName}
                        </span>
                      </label>
                      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-mist bg-snow px-3">
                        <input
                          type="radio"
                          name="parking"
                          checked={parkingChoice === 'none'}
                          onChange={() => setParkingChoice('none')}
                        />
                        <span className="text-body-sm text-ink">No parking</span>
                      </label>
                    </div>
                  ) : (
                    <p className="mt-2 text-body-sm text-slate">
                      No suitable bay is free. Attendance can still be recorded without parking.
                    </p>
                  )}
                </fieldset>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  size="kiosk"
                  loading={record.isPending}
                  disabled={record.isPending}
                  icon={direction === 'IN' ? <CheckIcon size={20} /> : <ArrowRightIcon size={20} />}
                  onClick={() => record.mutate()}
                  className="min-w-[220px]"
                >
                  {direction === 'IN'
                    ? chosenBay
                      ? `Mark IN & park ${chosenBay.code}`
                      : 'Mark IN'
                    : 'Mark OUT'}
                </Button>
                <button
                  type="button"
                  className="inline-flex min-h-12 items-center rounded-md px-3 text-body-sm font-medium text-slate underline underline-offset-2 hover:text-ink"
                  onClick={() =>
                    setDirectionOverride(direction === inferredDirection ? (direction === 'IN' ? 'OUT' : 'IN') : null)
                  }
                >
                  {directionOverride
                    ? `Use ${inferredDirection} instead`
                    : `Change direction to ${direction === 'IN' ? 'OUT' : 'IN'}`}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-12 items-center rounded-md px-3 text-body-sm text-slate hover:text-ink"
                  onClick={() => {
                    setSelected(null);
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  Choose someone else
                </button>
              </div>

              {formError ? (
                <p role="alert" className="mt-4 rounded-md bg-error-surface px-3 py-2 text-body-sm text-error-ink">
                  {formError}
                </p>
              ) : null}
            </>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/guests"
                className="inline-flex min-h-12 items-center rounded-full-2 bg-monday-violet px-6 text-body-sm font-medium text-snow"
              >
                Open guest register
              </Link>
              <Link
                to="/parking"
                className="inline-flex min-h-12 items-center rounded-full-2 border border-slate px-6 text-body-sm font-medium text-ink"
              >
                Open parking board
              </Link>
            </div>
          )}
        </Card>
      ) : null}

      <section
        aria-labelledby="activity-heading"
        className="space-y-3"
        data-testid="kiosk-activity"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="activity-heading" className="text-subheading font-medium tracking-subheading text-ink">
              Today’s activity
            </h2>
            <p className="text-body-sm text-slate">Newest first · {todayLocal()}</p>
          </div>
        </div>

        {activity.isLoading ? (
          <Card>
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </Card>
        ) : activity.isError ? (
          <ErrorState
            title="Today’s activity could not load."
            onRetry={() => activity.refetch()}
          />
        ) : activity.data?.items.length === 0 ? (
          <EmptyState
            title="No one has been logged yet today."
            description="Search for a staff member above to record the first entry or exit."
          />
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-mist">
              {activity.data?.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                  <ClockIcon size={17} className="text-slate" />
                  <span className="w-12 text-body-sm font-medium text-ink">
                    {formatTime(item.occurredAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                    {item.employeeName}
                  </span>
                  <StatusPill tone={item.direction === 'IN' ? 'PRESENT' : 'INACTIVE'}>
                    {item.direction}
                  </StatusPill>
                  <span className="hidden text-caption text-slate sm:inline">
                    {item.recordedByName ? `by ${item.recordedByName}` : ''}
                  </span>
                  {item.canUndo ? (
                    <button
                      type="button"
                      className="text-body-sm font-medium text-slate underline underline-offset-2 hover:text-ink"
                      onClick={() => undo.mutate(item.id)}
                      disabled={undo.isPending}
                    >
                      Undo
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <Modal
        open={vehicleOpen}
        onClose={() => setVehicleOpen(false)}
        title={`Add a vehicle for ${employee?.fullName ?? 'this employee'}`}
        description="Security can register a vehicle during a gate check-in."
        footer={
          <>
            <Button variant="outlined" onClick={() => setVehicleOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={addVehicle.isPending}
              disabled={!vehicleForm.plate}
              onClick={() => addVehicle.mutate()}
            >
              Add vehicle
            </Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Plate"
            value={vehicleForm.plate}
            onChange={(event) => setVehicleForm({ ...vehicleForm, plate: event.target.value })}
            error={vehicleFieldErrors.plate}
            required
          />
          <Select
            label="Vehicle type"
            value={vehicleForm.vehicleType}
            onChange={(event) =>
              setVehicleForm({
                ...vehicleForm,
                vehicleType: event.target.value as typeof vehicleForm.vehicleType,
              })
            }
            options={[
              { value: 'car', label: 'Car' },
              { value: 'motorbike', label: 'Motorbike' },
              { value: 'van', label: 'Van' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <Input
            label="Make"
            value={vehicleForm.make}
            onChange={(event) => setVehicleForm({ ...vehicleForm, make: event.target.value })}
          />
          <Input
            label="Model"
            value={vehicleForm.model}
            onChange={(event) => setVehicleForm({ ...vehicleForm, model: event.target.value })}
          />
          <Input
            label="Colour"
            value={vehicleForm.colour}
            onChange={(event) => setVehicleForm({ ...vehicleForm, colour: event.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
