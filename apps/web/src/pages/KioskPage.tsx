import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateEventResponse,
  KioskActivityResponse,
  KioskEmployeeOptionsResponse,
  KioskEmployeeResult,
  KioskSearchResponse,
} from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import {
  formatTime,
  localInputToIso,
  toLocalInputValue,
  todayLocal,
} from '../lib/dates';
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
  ChevronDownIcon,
  ClockIcon,
  SearchIcon,
} from '../components/icons';
import { cn } from '../lib/cn';

function resultLabel(employee: KioskEmployeeResult): string {
  return employee.code;
}

export function KioskPage() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [selected, setSelected] = useState<KioskEmployeeResult | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [directionOverride, setDirectionOverride] = useState<'IN' | 'OUT' | null>(null);
  const [timeOverride, setTimeOverride] = useState(false);
  const [eventTime, setEventTime] = useState(() => toLocalInputValue());
  const [formError, setFormError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
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
  const canEditEmployee = user?.role === 'SECURITY' || user?.role === 'HR';
  const searchRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
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

  const employeeOptions = useQuery({
    queryKey: ['kiosk', 'employees'],
    queryFn: () => apiFetch<KioskEmployeeOptionsResponse>('/kiosk/employees'),
    staleTime: 30_000,
  });

  const activity = useQuery({
    queryKey: ['kiosk', 'activity'],
    queryFn: () => apiFetch<KioskActivityResponse>('/kiosk/activity'),
    refetchInterval: 30_000,
  });

  const results = useMemo(() => search.data?.employees ?? [], [search.data]);
  const pickerResults = useMemo(() => {
    const term = pickerQuery.trim().toLowerCase();
    return (employeeOptions.data?.employees ?? [])
      .filter((employee) =>
        term
          ? `${employee.fullName} ${employee.code} ${employee.department}`
              .toLowerCase()
              .includes(term)
          : true,
      )
      .slice(0, 100);
  }, [employeeOptions.data, pickerQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [search.data]);

  useEffect(() => {
    if (!selected || !search.data) return;
    const fresh = results.find((result) => result.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [results, selected?.id]);

  useEffect(() => {
    if (!selected || !employeeOptions.data) return;
    const fresh = employeeOptions.data.employees.find((employee) => employee.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [employeeOptions.data, selected?.id]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pickerOpen]);

  const inferredDirection: 'IN' | 'OUT' = selected?.currentState.onCampus ? 'OUT' : 'IN';
  const direction = directionOverride ?? inferredDirection;

  useEffect(() => {
    setTimeOverride(false);
    setEventTime(toLocalInputValue());
  }, [selected?.id]);

  const record = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Choose a person first.');
      setFormError(null);
      const occurredAt = timeOverride ? localInputToIso(eventTime) : undefined;
      if (timeOverride && !occurredAt) {
        throw new Error('Choose a valid event time.');
      }
      return apiFetch<CreateEventResponse>('/events', {
        method: 'POST',
        body: {
          employeeId: selected.id,
          direction,
          ...(occurredAt ? { occurredAt } : {}),
        },
      });
    },
    onSuccess: async (eventResult) => {
      setSelected((current) => {
        if (!current) return current;
        return {
          ...current,
          currentState: {
            onCampus: direction === 'IN',
            since: direction === 'IN' ? eventResult.event.occurredAt : null,
            lastDirection: direction,
            lastOccurredAt: eventResult.event.occurredAt,
          },
        };
      });

      toast.push({
        title: `${selected!.fullName} marked ${direction}`,
        message:
          direction === 'IN'
            ? 'On campus.'
            : 'Off campus and attendance recorded.',
        tone: 'success',
        action: eventResult.undoUntil
          ? {
              label: 'Undo this entry',
              onClick: () => undo.mutate(eventResult.event.id),
            }
          : undefined,
      });

      setDirectionOverride(null);
      setTimeOverride(false);
      setEventTime(toLocalInputValue());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
        queryClient.invalidateQueries({ queryKey: ['on-campus'] }),
      ]);
      const refreshed = await search.refetch();
      const next = refreshed.data?.employees.find(
        (item) => item.id === selected!.id,
      );
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
        queryClient.invalidateQueries({ queryKey: ['on-campus'] }),
      ]);
      await Promise.all([search.refetch(), employeeOptions.refetch()]);
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
          employeeId: selected!.id,
        },
      }),
    onSuccess: async () => {
      toast.push({ title: 'Vehicle added', message: vehicleForm.plate, tone: 'success' });
      setVehicleOpen(false);
      setVehicleForm({ plate: '', make: '', model: '', colour: '', vehicleType: 'car' });
      setVehicleFieldErrors({});
      const refreshed = await Promise.all([search.refetch(), employeeOptions.refetch()]);
      const next = refreshed[0].data?.employees.find((item) => item.id === selected!.id);
      if (next) setSelected(next);
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

  const choose = (employee: KioskEmployeeResult) => {
    setSelected(employee);
    setDirectionOverride(null);
    setTimeOverride(false);
    setEventTime(toLocalInputValue());
    setFormError(null);
    setPickerOpen(false);
    setPickerQuery('');
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
            Select an employee or search by name, staff number or number plate.
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="relative" ref={pickerRef}>
          <Input
            label="Select employee"
            value={pickerQuery}
            onFocus={() => setPickerOpen(true)}
            onChange={(event) => {
              setPickerQuery(event.target.value);
              setPickerOpen(true);
            }}
            placeholder="Choose an employee…"
            role="combobox"
            aria-expanded={pickerOpen}
            aria-controls="employee-picker-results"
            suffix={<ChevronDownIcon size={19} />}
          />
          {pickerOpen ? (
            <div
              id="employee-picker-results"
              role="listbox"
              className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-3xl border border-mist bg-snow p-2 shadow-xl"
            >
              {employeeOptions.isLoading ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ) : employeeOptions.isError ? (
                <p className="p-3 text-body-sm text-error-ink">
                  Employees could not load. Use search instead.
                </p>
              ) : pickerResults.length === 0 ? (
                <p className="p-3 text-body-sm text-slate">No matching employee.</p>
              ) : (
                pickerResults.map((employee) => (
                  <button
                    key={employee.id}
                    type="button"
                    role="option"
                    aria-selected={selected?.id === employee.id}
                    onClick={() => choose(employee)}
                    className={cn(
                      'flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors',
                      selected?.id === employee.id ? 'bg-periwinkle' : 'hover:bg-cloud',
                    )}
                  >
                    <Avatar name={employee.fullName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-ink">
                        {employee.fullName}
                      </span>
                      <span className="block truncate text-caption text-slate">
                        {employee.code} · {employee.department}
                      </span>
                    </span>
                    <StatusPill tone={employee.currentState.onCampus ? 'ON_SITE' : 'INACTIVE'}>
                      {employee.currentState.onCampus ? 'ON CAMPUS' : 'OFF CAMPUS'}
                    </StatusPill>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <Input
            ref={searchRef}
            label="Search name or plate"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Type a name, code or number plate…"
            aria-label="Search employees and vehicles"
            role="combobox"
            aria-expanded={Boolean(query && results.length > 0)}
            aria-controls="kiosk-results"
            aria-activedescendant={
              results[activeIndex] ? `kiosk-result-employee-${results[activeIndex]!.id}` : undefined
            }
            suffix={<SearchIcon size={20} />}
          />
          {debouncedQuery.trim() ? (
            <div
              id="kiosk-results"
              role="listbox"
              className="absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-3xl border border-mist bg-snow p-2 shadow-xl"
            >
              {search.isLoading ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ) : search.isError ? (
                <p className="p-3 text-body-sm text-error-ink">Search is unavailable. Try again.</p>
              ) : results.length === 0 ? (
                <p className="p-3 text-body-sm text-slate">No matching employee or vehicle.</p>
              ) : (
                results.map((employee, index) => (
                  <button
                    key={employee.id}
                    id={`kiosk-result-employee-${employee.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(employee)}
                    className={cn(
                      'flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors',
                      index === activeIndex ? 'bg-periwinkle' : 'hover:bg-cloud',
                    )}
                  >
                    <Avatar name={employee.fullName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-ink">
                        {employee.fullName}
                      </span>
                      <span className="block truncate text-caption text-slate">
                        {resultLabel(employee)} · {employee.department}
                      </span>
                    </span>
                    <StatusPill tone={employee.currentState.onCampus ? 'ON_SITE' : 'INACTIVE'}>
                      {employee.currentState.onCampus ? 'ON CAMPUS' : 'OFF CAMPUS'}
                    </StatusPill>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
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
                <StatusPill tone={selected.currentState.onCampus ? 'ON_SITE' : 'INACTIVE'}>
                  {selected.currentState.onCampus ? 'ON CAMPUS' : 'OFF CAMPUS'}
                </StatusPill>
              </div>
              <p className="mt-1 text-body-sm text-slate">
                {selected.code} · {selected.department}
              </p>
              <p className="mt-3 text-body text-ink">
                {selected.currentState.onCampus && selected.currentState.since
                  ? `On campus since ${formatTime(selected.currentState.since)}`
                  : selected.currentState.lastOccurredAt
                    ? `Off campus, last left ${formatTime(selected.currentState.lastOccurredAt)}`
                    : 'No attendance recorded yet.'}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {selected.vehicles.length === 0 ? (
              <p className="text-body-sm text-slate">No vehicles registered.</p>
            ) : (
              selected.vehicles.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-2 rounded-md bg-cloud px-3 py-2 text-body-sm text-ink"
                >
                  <CarIcon size={17} />
                  <span className="font-medium">{item.plate}</span>
                  <span className="text-slate">
                    {[item.make, item.model, item.colour].filter(Boolean).join(' · ') || 'Vehicle'}
                  </span>
                </span>
              ))
            )}
            {canEditEmployee ? (
              <Button variant="text" size="sm" onClick={() => setVehicleOpen(true)}>
                Add vehicle
              </Button>
            ) : null}
          </div>

          <fieldset className="mt-5 rounded-3xl bg-cloud p-4">
            <legend className="px-1 text-body-sm font-medium text-ink">Event time</legend>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-body-sm text-slate">
                {timeOverride
                  ? 'Custom time will be used for this attendance event.'
                  : 'The current time will be recorded.'}
              </p>
              <button
                type="button"
                className="inline-flex min-h-10 items-center rounded-md px-2 text-body-sm font-medium text-slate underline underline-offset-2 hover:text-ink"
                onClick={() => {
                  if (!timeOverride) setEventTime(toLocalInputValue());
                  setTimeOverride((current) => !current);
                }}
              >
                {timeOverride ? 'Use current time' : 'Change time'}
              </button>
            </div>
            {timeOverride ? (
              <div className="mt-3 max-w-xs">
                <Input
                  label="Time (Mauritius)"
                  type="datetime-local"
                  value={eventTime}
                  max={toLocalInputValue()}
                  onChange={(event) => setEventTime(event.target.value)}
                />
              </div>
            ) : null}
          </fieldset>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              size="kiosk"
              loading={record.isPending}
              disabled={record.isPending}
              icon={direction === 'IN' ? <CheckIcon size={20} /> : <ArrowRightIcon size={20} />}
              onClick={() => record.mutate()}
              className="min-w-[220px]"
            >
              {direction === 'IN' ? 'Mark IN' : 'Mark OUT'}
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
                setPickerQuery('');
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
            description="Search for an employee above to record the first entry or exit."
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
                  <StatusPill tone={item.direction === 'IN' ? 'ON_SITE' : 'INACTIVE'}>
                    {item.direction}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <Modal
        open={vehicleOpen}
        onClose={() => setVehicleOpen(false)}
        title="Add a vehicle"
        description="A vehicle belongs to this employee. They may have more than one."
        footer={
          <>
            <Button variant="outlined" onClick={() => setVehicleOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="kiosk-vehicle-form"
              loading={addVehicle.isPending}
              disabled={!vehicleForm.plate}
            >
              Add vehicle
            </Button>
          </>
        }
      >
        <form
          id="kiosk-vehicle-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            addVehicle.mutate();
          }}
        >
          <Input
            label="Plate"
            value={vehicleForm.plate}
            onChange={(event) => setVehicleForm({ ...vehicleForm, plate: event.target.value })}
            error={vehicleFieldErrors.plate?.[0]}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
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
            <Select
              label="Type"
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
          </div>
        </form>
      </Modal>
    </div>
  );
}
