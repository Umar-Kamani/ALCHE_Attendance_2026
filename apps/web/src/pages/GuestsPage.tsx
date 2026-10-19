import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Guest,
  GuestDetailResponse,
  GuestListResponse,
  GuestVisit,
  GuestVisitListResponse,
  KioskSearchResponse,
} from '@alche/shared';
import { ApiError, apiDownload, apiFetch } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import {
  Avatar,
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
import { DownloadIcon, PlusIcon, SearchIcon } from '../components/icons';
import {
  formatDate,
  formatDateTime,
  formatTime,
  localInputToIso,
  todayLocal,
  toLocalInputValue,
} from '../lib/dates';
import { cn } from '../lib/cn';

type Tab = 'today' | 'register' | 'directory';

interface VisitForm {
  guestMode: 'existing' | 'new';
  guestId: string;
  guestName: string;
  guestFullName: string;
  company: string;
  phone: string;
  idNumber: string;
  email: string;
  hostId: string;
  hostName: string;
  purpose: string;
  expectedFrom: string;
  expectedTo: string;
  badgeNo: string;
  note: string;
  vehicleEnabled: boolean;
  plate: string;
  make: string;
  model: string;
  colour: string;
  vehicleType: 'car' | 'motorbike' | 'van' | 'other';
}

function freshVisitForm(): VisitForm {
  const now = toLocalInputValue();
  const later = toLocalInputValue(new Date(Date.now() + 2 * 60 * 60_000).toISOString());
  return {
    guestMode: 'existing',
    guestId: '',
    guestName: '',
    guestFullName: '',
    company: '',
    phone: '',
    idNumber: '',
    email: '',
    hostId: '',
    hostName: '',
    purpose: '',
    expectedFrom: now,
    expectedTo: later,
    badgeNo: '',
    note: '',
    vehicleEnabled: false,
    plate: '',
    make: '',
    model: '',
    colour: '',
    vehicleType: 'car',
  };
}

const STATUS_TONE: Record<string, 'ON_SITE' | 'OVERDUE' | 'PRESENT' | 'NEUTRAL' | 'INACTIVE'> = {
  EXPECTED: 'NEUTRAL',
  ON_SITE: 'ON_SITE',
  OVERDUE: 'OVERDUE',
  DEPARTED: 'PRESENT',
  CANCELLED: 'INACTIVE',
};

export function GuestsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('today');
  const [registerFrom, setRegisterFrom] = useState(todayLocal());
  const [registerTo, setRegisterTo] = useState(todayLocal());
  const [registerStatus, setRegisterStatus] = useState('');
  const [registerHost, setRegisterHost] = useState('');
  const [registerHostName, setRegisterHostName] = useState('');
  const [registerHostSearch, setRegisterHostSearch] = useState('');
  const debouncedRegisterHostSearch = useDebouncedValue(registerHostSearch, 250);
  const [registerPage, setRegisterPage] = useState(1);
  const [guestSearch, setGuestSearch] = useState('');
  const debouncedGuestSearch = useDebouncedValue(guestSearch, 250);
  const [visitOpen, setVisitOpen] = useState(false);
  const [visitMode, setVisitMode] = useState<'pre-register' | 'check-in'>('pre-register');
  const [visitForm, setVisitForm] = useState<VisitForm>(freshVisitForm);
  const [guestPicker, setGuestPicker] = useState('');
  const debouncedGuestPicker = useDebouncedValue(guestPicker, 250);
  const [hostPicker, setHostPicker] = useState('');
  const debouncedHostPicker = useDebouncedValue(hostPicker, 250);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [checkoutVisit, setCheckoutVisit] = useState<GuestVisit | null>(null);
  const [releaseParking, setReleaseParking] = useState(false);
  const [checkoutNote, setCheckoutNote] = useState('');
  const [newGuestOpen, setNewGuestOpen] = useState(false);
  const [newGuest, setNewGuest] = useState({
    fullName: '',
    company: '',
    phone: '',
    idNumber: '',
    email: '',
  });
  const [detailGuestId, setDetailGuestId] = useState<string | null>(null);

  const today = todayLocal();
  const todayVisits = useQuery({
    queryKey: ['guest-visits', 'today', today],
    queryFn: () => apiFetch<GuestVisitListResponse>(`/guest-visits?date=${today}`),
  });
  const register = useQuery({
    queryKey: [
      'guest-visits',
      'register',
      registerFrom,
      registerTo,
      registerStatus,
      registerHost,
      registerPage,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        from: registerFrom,
        to: registerTo,
        page: String(registerPage),
      });
      if (registerStatus) params.set('status', registerStatus);
      if (registerHost) params.set('host', registerHost);
      return apiFetch<GuestVisitListResponse>(`/guest-visits?${params.toString()}`);
    },
    enabled: tab === 'register',
  });
  const registerHostResults = useQuery({
    queryKey: ['guests', 'register-host', debouncedRegisterHostSearch],
    queryFn: () =>
      apiFetch<KioskSearchResponse>(
        `/kiosk/search?q=${encodeURIComponent(debouncedRegisterHostSearch)}`,
      ),
    enabled:
      tab === 'register' &&
      debouncedRegisterHostSearch.length >= 2 &&
      !registerHost,
  });
  const guestDirectory = useQuery({
    queryKey: ['guests', debouncedGuestSearch],
    queryFn: () =>
      apiFetch<GuestListResponse>(
        `/guests?${debouncedGuestSearch ? `q=${encodeURIComponent(debouncedGuestSearch)}&` : ''}page=1`,
      ),
    enabled: tab === 'directory' || visitOpen,
  });
  const guestPickerResults = useQuery({
    queryKey: ['guests', 'picker', debouncedGuestPicker],
    queryFn: () =>
      apiFetch<GuestListResponse>(`/guests?q=${encodeURIComponent(debouncedGuestPicker)}&page=1`),
    enabled: visitOpen && visitForm.guestMode === 'existing' && debouncedGuestPicker.length >= 2 && !visitForm.guestId,
  });
  const hostResults = useQuery({
    queryKey: ['guests', 'host-picker', debouncedHostPicker],
    queryFn: () =>
      apiFetch<KioskSearchResponse>(
        `/kiosk/search?q=${encodeURIComponent(debouncedHostPicker)}`,
      ),
    enabled: visitOpen && debouncedHostPicker.length >= 2 && !visitForm.hostId,
  });
  const guestDetail = useQuery({
    queryKey: ['guests', 'detail', detailGuestId],
    queryFn: () => apiFetch<GuestDetailResponse>(`/guests/${detailGuestId}`),
    enabled: Boolean(detailGuestId),
  });

  const refreshGuests = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['guest-visits'] }),
      queryClient.invalidateQueries({ queryKey: ['guests'] }),
      queryClient.invalidateQueries({ queryKey: ['parking'] }),
      queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
    ]);
  };

  const createVisit = useMutation({
    mutationFn: async (mode: 'pre-register' | 'check-in') => {
      const body = {
        ...(visitForm.guestMode === 'existing'
          ? { guestId: visitForm.guestId }
          : {
              guest: {
                fullName: visitForm.guestFullName,
                company: visitForm.company || null,
                phone: visitForm.phone || null,
                idNumber: visitForm.idNumber || null,
                email: visitForm.email || null,
              },
            }),
        hostEmployeeId: visitForm.hostId,
        purpose: visitForm.purpose,
        expectedFrom: localInputToIso(visitForm.expectedFrom),
        expectedTo: localInputToIso(visitForm.expectedTo),
        badgeNo: visitForm.badgeNo || null,
        note: visitForm.note || null,
        ...(visitForm.vehicleEnabled
          ? {
              vehicle: {
                plate: visitForm.plate,
                make: visitForm.make || null,
                model: visitForm.model || null,
                colour: visitForm.colour || null,
                vehicleType: visitForm.vehicleType,
              },
            }
          : {}),
      };
      const created = await apiFetch<{ visit: GuestVisit }>('/guest-visits', {
        method: 'POST',
        body,
      });
      if (mode === 'check-in') {
        const checkedIn = await apiFetch<{ visit: GuestVisit }>(
          `/guest-visits/${created.visit.id}/check-in`,
          { method: 'POST', body: {} },
        );
        return checkedIn.visit;
      }
      return created.visit;
    },
    onSuccess: async (visit, mode) => {
      toast.push({
        title: mode === 'check-in' ? 'Guest checked in' : 'Guest pre-registered',
        message: visit.guest.fullName,
        tone: 'success',
      });
      setVisitOpen(false);
      setVisitForm(freshVisitForm());
      setFieldErrors({});
      await refreshGuests();
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Guest visit could not be saved',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const checkIn = useMutation({
    mutationFn: (visitId: string) =>
      apiFetch<{ visit: GuestVisit }>(`/guest-visits/${visitId}/check-in`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: async (data) => {
      toast.push({
        title: 'Guest checked in',
        message: data.visit.guest.fullName,
        tone: 'success',
      });
      await refreshGuests();
    },
    onError: (error) => {
      toast.push({
        title: 'Check-in failed',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const checkOut = useMutation({
    mutationFn: (input: { visitId: string; release: boolean; note: string }) =>
      apiFetch<{ visit: GuestVisit }>(`/guest-visits/${input.visitId}/check-out`, {
        method: 'POST',
        body: { releaseParking: input.release, note: input.note || null },
      }),
    onSuccess: async (data) => {
      toast.push({
        title: 'Guest checked out',
        message: `${data.visit.guest.fullName} departed.`,
        tone: 'success',
      });
      setCheckoutVisit(null);
      setReleaseParking(false);
      setCheckoutNote('');
      await refreshGuests();
    },
    onError: (error) => {
      toast.push({
        title: 'Check-out failed',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const createGuest = useMutation({
    mutationFn: () =>
      apiFetch<Guest>('/guests', {
        method: 'POST',
        body: {
          fullName: newGuest.fullName,
          company: newGuest.company || null,
          phone: newGuest.phone || null,
          idNumber: newGuest.idNumber || null,
          email: newGuest.email || null,
        },
      }),
    onSuccess: async (guest) => {
      toast.push({ title: 'Guest added', message: guest.fullName, tone: 'success' });
      setNewGuestOpen(false);
      setNewGuest({ fullName: '', company: '', phone: '', idNumber: '', email: '' });
      await refreshGuests();
    },
    onError: (error) => {
      toast.push({
        title: 'Guest could not be added',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const deactivateGuest = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Guest>(`/guests/${id}`, { method: 'PATCH', body: { active: false } }),
    onSuccess: async () => {
      toast.push({ title: 'Guest deactivated', tone: 'success' });
      await refreshGuests();
    },
    onError: (error) => {
      toast.push({
        title: 'Could not deactivate guest',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const exportRegister = async () => {
    try {
      const params = new URLSearchParams({ from: registerFrom, to: registerTo });
      if (registerHost) params.set('host', registerHost);
      if (registerStatus) params.set('status', registerStatus);
      await apiDownload(
        `/guest-visits/export.csv?${params.toString()}`,
        `guests_${registerFrom}_${registerTo}.csv`,
      );
      toast.push({ title: 'Guest register exported', tone: 'success' });
    } catch (error) {
      toast.push({
        title: 'Export failed',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    }
  };

  const openVisitForm = (mode: 'pre-register' | 'check-in') => {
    setVisitForm(freshVisitForm());
    setGuestPicker('');
    setHostPicker('');
    setFieldErrors({});
    setVisitOpen(true);
    setVisitMode(mode);
  };

  const submitVisit = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    createVisit.mutate(visitMode);
  };

  const startCheckout = (visit: GuestVisit) => {
    if (visit.activeParking) {
      setCheckoutVisit(visit);
      setReleaseParking(true);
      setCheckoutNote('');
    } else {
      checkOut.mutate({ visitId: visit.id, release: false, note: '' });
    }
  };

  const counts = todayVisits.data?.counts;

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Guests"
          description="Pre-registration, gate check-in and the permanent visit register."
          actions={
            <>
              <Button variant="outlined" icon={<PlusIcon size={18} />} onClick={() => setNewGuestOpen(true)}>
                New guest
              </Button>
              <Button variant="outlined" onClick={() => openVisitForm('check-in')}>
                Check in walk-in
              </Button>
              <Button icon={<PlusIcon size={18} />} onClick={() => openVisitForm('pre-register')}>
                Pre-register visit
              </Button>
            </>
          }
        />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['today', 'Today'],
              ['register', 'Register'],
              ['directory', 'Guest directory'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'min-h-11 rounded-md px-4 text-body-sm font-medium transition-colors',
                tab === value ? 'bg-periwinkle text-ink' : 'bg-snow text-slate hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'today' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Expected', counts?.expected ?? 0],
              ['On site', counts?.onSite ?? 0],
              ['Overdue', counts?.overdue ?? 0],
              ['Departed today', counts?.departed ?? 0],
            ].map(([label, value]) => (
              <Card key={label} className="p-5">
                <p className="text-caption font-medium uppercase tracking-caption text-slate">{label}</p>
                <p className="mt-1 text-heading-sm font-medium text-ink">{value}</p>
              </Card>
            ))}
          </div>

          {todayVisits.isLoading ? (
            <Card>
              <TableSkeleton rows={6} columns={6} />
            </Card>
          ) : todayVisits.isError ? (
            <ErrorState title="Today’s guest list could not load." onRetry={() => todayVisits.refetch()} />
          ) : todayVisits.data?.items.length === 0 ? (
            <EmptyState
              title="No guest visits today."
              description="Pre-register an expected visitor or check in a walk-in guest."
              action={
                <Button icon={<PlusIcon size={18} />} onClick={() => openVisitForm('check-in')}>
                  Check in a guest
                </Button>
              }
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Guest</TH>
                    <TH>Host</TH>
                    <TH>Visit window</TH>
                    <TH>Badge</TH>
                    <TH>Vehicle</TH>
                    <TH>Status</TH>
                    <TH>Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {todayVisits.data?.items.map((visit) => (
                    <TR key={visit.id}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={visit.guest.fullName} size="sm" />
                          <span>
                            <span className="block font-medium text-ink">{visit.guest.fullName}</span>
                            <span className="block text-caption text-slate">
                              {visit.guest.company ?? '—'}
                            </span>
                          </span>
                        </div>
                      </TD>
                      <TD>
                        {visit.host.fullName}
                        <span className="block text-caption text-slate">{visit.host.department}</span>
                      </TD>
                      <TD className="whitespace-nowrap text-caption text-slate">
                        {formatTime(visit.expectedFrom)}–{formatTime(visit.expectedTo)}
                        {visit.checkedInAt ? (
                          <span className="block">In {formatTime(visit.checkedInAt)}</span>
                        ) : null}
                        {visit.checkedOutAt ? (
                          <span className="block">Out {formatTime(visit.checkedOutAt)}</span>
                        ) : null}
                      </TD>
                      <TD>{visit.badgeNo ?? '—'}</TD>
                      <TD>
                        {visit.vehicle?.plate ?? '—'}
                        {visit.activeParking ? (
                          <span className="mt-1 block">
                            <StatusPill tone="ON_SITE">{visit.activeParking.bayCode}</StatusPill>
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        <StatusPill status={visit.status}>{visit.status.replace('_', ' ')}</StatusPill>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {visit.status === 'EXPECTED' ? (
                            <Button
                              size="sm"
                              loading={checkIn.isPending}
                              onClick={() => checkIn.mutate(visit.id)}
                            >
                              Check in
                            </Button>
                          ) : null}
                          {visit.status === 'ON_SITE' || visit.status === 'OVERDUE' ? (
                            <Button
                              variant="outlined"
                              size="sm"
                              loading={checkOut.isPending}
                              onClick={() => startCheckout(visit)}
                            >
                              Check out
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </>
      ) : null}

      {tab === 'register' ? (
        <>
          <Card>
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <Input
                label="From"
                type="date"
                value={registerFrom}
                onChange={(event) => {
                  setRegisterFrom(event.target.value);
                  setRegisterPage(1);
                }}
              />
              <Input
                label="To"
                type="date"
                value={registerTo}
                onChange={(event) => {
                  setRegisterTo(event.target.value);
                  setRegisterPage(1);
                }}
              />
              <Select
                label="Status"
                value={registerStatus}
                onChange={(event) => {
                  setRegisterStatus(event.target.value);
                  setRegisterPage(1);
                }}
                placeholder="All statuses"
                options={[
                  { value: 'EXPECTED', label: 'Expected' },
                  { value: 'ON_SITE', label: 'On site' },
                  { value: 'OVERDUE', label: 'Overdue' },
                  { value: 'DEPARTED', label: 'Departed' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
              />
              <div>
                <Input
                  label="Host"
                  value={registerHost ? registerHostName : registerHostSearch}
                  onChange={(event) => {
                    setRegisterHostSearch(event.target.value);
                    setRegisterHost('');
                    setRegisterHostName('');
                    setRegisterPage(1);
                  }}
                  placeholder="Search host"
                />
                {!registerHost && debouncedRegisterHostSearch.length >= 2 ? (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-mist bg-snow">
                    {registerHostResults.data?.employees.length ? (
                      registerHostResults.data.employees.map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          className="flex min-h-12 w-full items-center justify-between border-b border-mist px-3 text-left last:border-0 hover:bg-cloud"
                          onClick={() => {
                            setRegisterHost(employee.id);
                            setRegisterHostName(employee.fullName);
                            setRegisterHostSearch(employee.fullName);
                            setRegisterPage(1);
                          }}
                        >
                          <span className="text-body-sm text-ink">{employee.fullName}</span>
                          <span className="text-caption text-slate">{employee.department}</span>
                        </button>
                      ))
                    ) : (
                      <p className="p-3 text-body-sm text-slate">No matching host.</p>
                    )}
                  </div>
                ) : null}
                {registerHost ? (
                  <button
                    type="button"
                    className="mt-1 text-caption font-medium text-slate underline underline-offset-2"
                    onClick={() => {
                      setRegisterHost('');
                      setRegisterHostName('');
                      setRegisterHostSearch('');
                    }}
                  >
                    Clear host filter
                  </button>
                ) : null}
              </div>
              <div className="flex items-end">
                <Button icon={<DownloadIcon size={18} />} onClick={exportRegister}>
                  Export CSV
                </Button>
              </div>
            </div>
          </Card>

          {register.isLoading ? (
            <Card>
              <TableSkeleton rows={8} columns={7} />
            </Card>
          ) : register.isError ? (
            <ErrorState title="Guest register could not load." onRetry={() => register.refetch()} />
          ) : register.data?.items.length === 0 ? (
            <EmptyState
              title="No visits in this range."
              description="Try a wider date range or clear the status filter."
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Date in</TH>
                    <TH>Guest</TH>
                    <TH>Host</TH>
                    <TH>Purpose</TH>
                    <TH>Badge</TH>
                    <TH>Date out</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {register.data?.items.map((visit) => (
                    <TR key={visit.id}>
                      <TD className="whitespace-nowrap">
                        {formatDate(visit.checkedInAt ?? visit.expectedFrom)}
                        <span className="block text-caption text-slate">
                          {visit.checkedInAt ? formatTime(visit.checkedInAt) : 'Expected'}
                        </span>
                      </TD>
                      <TD>
                        {visit.guest.fullName}
                        <span className="block text-caption text-slate">{visit.guest.company ?? '—'}</span>
                      </TD>
                      <TD>{visit.host.fullName}</TD>
                      <TD>{visit.purpose}</TD>
                      <TD>{visit.badgeNo ?? '—'}</TD>
                      <TD className="whitespace-nowrap">
                        {visit.checkedOutAt ? (
                          <>
                            {formatDate(visit.checkedOutAt)}
                            <span className="block text-caption text-slate">
                              {formatTime(visit.checkedOutAt)}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD>
                        <StatusPill status={visit.status}>{visit.status.replace('_', ' ')}</StatusPill>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={register.data?.meta.page ?? 1}
                totalPages={register.data?.meta.totalPages ?? 1}
                onPage={setRegisterPage}
              />
            </Card>
          )}
        </>
      ) : null}

      {tab === 'directory' ? (
        <>
          <Card>
            <Input
              label="Search guests"
              value={guestSearch}
              onChange={(event) => setGuestSearch(event.target.value)}
              placeholder="Name, company, phone or ID"
              suffix={<SearchIcon size={20} />}
            />
          </Card>
          {guestDirectory.isLoading ? (
            <Card>
              <TableSkeleton rows={6} columns={5} />
            </Card>
          ) : guestDirectory.isError ? (
            <ErrorState title="Guest directory could not load." onRetry={() => guestDirectory.refetch()} />
          ) : guestDirectory.data?.items.length === 0 ? (
            <EmptyState
              title="No guests match this search."
              description="Add a guest record to reuse it across repeat visits."
              action={
                <Button icon={<PlusIcon size={18} />} onClick={() => setNewGuestOpen(true)}>
                  New guest
                </Button>
              }
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Guest</TH>
                    <TH>Company</TH>
                    <TH>Phone</TH>
                    <TH>Visits</TH>
                    <TH>Last visit</TH>
                    <TH>Status</TH>
                    <TH>Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {guestDirectory.data?.items.map((guest) => (
                    <TR key={guest.id}>
                      <TD>
                        {guest.fullName}
                        <span className="block text-caption text-slate">{guest.idNumber ?? '—'}</span>
                      </TD>
                      <TD>{guest.company ?? '—'}</TD>
                      <TD>{guest.phone ?? '—'}</TD>
                      <TD>{guest.visitCount ?? 0}</TD>
                      <TD>{guest.lastVisitAt ? formatDateTime(guest.lastVisitAt) : '—'}</TD>
                      <TD>
                        <StatusPill tone={guest.active ? 'PRESENT' : 'INACTIVE'}>
                          {guest.active ? 'ACTIVE' : 'INACTIVE'}
                        </StatusPill>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="text" size="sm" onClick={() => setDetailGuestId(guest.id)}>
                            View
                          </Button>
                          {guest.active ? (
                            <Button
                              variant="text"
                              size="sm"
                              onClick={() => deactivateGuest.mutate(guest.id)}
                            >
                              Deactivate
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </>
      ) : null}

      <Modal
        open={visitOpen}
        onClose={() => setVisitOpen(false)}
        title={visitMode === 'check-in' ? 'Check in a guest' : 'Pre-register a visit'}
        description="A host is required. Guest identity is visible to authenticated staff only."
        size="lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setVisitOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="visit-form"
              loading={createVisit.isPending}
              disabled={!visitForm.hostId || !visitForm.purpose}
            >
              {visitMode === 'check-in' ? 'Check in now' : 'Pre-register'}
            </Button>
          </>
        }
      >
        <form id="visit-form" onSubmit={submitVisit} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={visitForm.guestMode === 'existing' ? 'filled' : 'outlined'}
              size="sm"
              onClick={() =>
                setVisitForm({
                  ...visitForm,
                  guestMode: 'existing',
                  guestId: '',
                  guestName: '',
                })
              }
            >
              Existing guest
            </Button>
            <Button
              variant={visitForm.guestMode === 'new' ? 'filled' : 'outlined'}
              size="sm"
              onClick={() =>
                setVisitForm({
                  ...visitForm,
                  guestMode: 'new',
                  guestId: '',
                  guestName: '',
                })
              }
            >
              New guest
            </Button>
          </div>

          {visitForm.guestMode === 'existing' ? (
            <>
              <Input
                label="Guest"
                value={visitForm.guestId ? visitForm.guestName : guestPicker}
                onChange={(event) => {
                  setGuestPicker(event.target.value);
                  setVisitForm({ ...visitForm, guestId: '', guestName: '' });
                }}
                placeholder="Search name or company"
                error={fieldErrors.guestId}
                required
              />
              {!visitForm.guestId && debouncedGuestPicker.length >= 2 ? (
                <div className="max-h-48 overflow-y-auto rounded-md border border-mist">
                  {guestPickerResults.data?.items.map((guest) => (
                    <button
                      key={guest.id}
                      type="button"
                      className="flex min-h-12 w-full items-center justify-between border-b border-mist px-3 text-left last:border-0 hover:bg-cloud"
                      onClick={() => {
                        setVisitForm({ ...visitForm, guestId: guest.id, guestName: guest.fullName });
                        setGuestPicker(guest.fullName);
                      }}
                    >
                      <span className="text-body-sm text-ink">{guest.fullName}</span>
                      <span className="text-caption text-slate">{guest.company ?? ''}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Full name"
                value={visitForm.guestFullName}
                onChange={(event) =>
                  setVisitForm({ ...visitForm, guestFullName: event.target.value })
                }
                required
              />
              <Input
                label="Company"
                value={visitForm.company}
                onChange={(event) => setVisitForm({ ...visitForm, company: event.target.value })}
              />
              <Input
                label="Phone"
                value={visitForm.phone}
                onChange={(event) => setVisitForm({ ...visitForm, phone: event.target.value })}
              />
              <Input
                label="ID / passport"
                value={visitForm.idNumber}
                onChange={(event) => setVisitForm({ ...visitForm, idNumber: event.target.value })}
              />
              <Input
                label="Email"
                type="email"
                value={visitForm.email}
                onChange={(event) => setVisitForm({ ...visitForm, email: event.target.value })}
                error={fieldErrors['guest.email']}
              />
            </div>
          )}

          <Input
            label="Host employee"
            value={visitForm.hostId ? visitForm.hostName : hostPicker}
            onChange={(event) => {
              setHostPicker(event.target.value);
              setVisitForm({ ...visitForm, hostId: '', hostName: '' });
            }}
            placeholder="Search the employee directory"
            error={fieldErrors.hostEmployeeId}
            required
          />
          {!visitForm.hostId && debouncedHostPicker.length >= 2 ? (
            <div className="max-h-48 overflow-y-auto rounded-md border border-mist">
              {hostResults.data?.employees.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  className="flex min-h-12 w-full items-center justify-between border-b border-mist px-3 text-left last:border-0 hover:bg-cloud"
                  onClick={() => {
                    setVisitForm({ ...visitForm, hostId: employee.id, hostName: employee.fullName });
                    setHostPicker(employee.fullName);
                  }}
                >
                  <span className="text-body-sm text-ink">{employee.fullName}</span>
                  <span className="text-caption text-slate">{employee.department}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Purpose"
              value={visitForm.purpose}
              onChange={(event) => setVisitForm({ ...visitForm, purpose: event.target.value })}
              error={fieldErrors.purpose}
              required
            />
            <Input
              label="Badge number"
              value={visitForm.badgeNo}
              onChange={(event) => setVisitForm({ ...visitForm, badgeNo: event.target.value })}
              hint="Free text; numbers are not unique."
            />
            <Input
              label="Expected from"
              type="datetime-local"
              value={visitForm.expectedFrom}
              onChange={(event) => setVisitForm({ ...visitForm, expectedFrom: event.target.value })}
            />
            <Input
              label="Expected to"
              type="datetime-local"
              value={visitForm.expectedTo}
              onChange={(event) => setVisitForm({ ...visitForm, expectedTo: event.target.value })}
              error={fieldErrors.expectedTo}
            />
          </div>
          <Textarea
            label="Note"
            value={visitForm.note}
            onChange={(event) => setVisitForm({ ...visitForm, note: event.target.value })}
          />

          <fieldset className="rounded-md border border-mist p-4">
            <label className="flex min-h-11 items-center gap-3 text-body-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={visitForm.vehicleEnabled}
                onChange={(event) =>
                  setVisitForm({ ...visitForm, vehicleEnabled: event.target.checked })
                }
              />
              Guest arrives with a vehicle
            </label>
            {visitForm.vehicleEnabled ? (
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <Input
                  label="Plate"
                  value={visitForm.plate}
                  onChange={(event) => setVisitForm({ ...visitForm, plate: event.target.value })}
                  error={fieldErrors['vehicle.plate']}
                  required
                />
                <Select
                  label="Vehicle type"
                  value={visitForm.vehicleType}
                  onChange={(event) =>
                    setVisitForm({
                      ...visitForm,
                      vehicleType: event.target.value as VisitForm['vehicleType'],
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
                  value={visitForm.make}
                  onChange={(event) => setVisitForm({ ...visitForm, make: event.target.value })}
                />
                <Input
                  label="Model"
                  value={visitForm.model}
                  onChange={(event) => setVisitForm({ ...visitForm, model: event.target.value })}
                />
                <Input
                  label="Colour"
                  value={visitForm.colour}
                  onChange={(event) => setVisitForm({ ...visitForm, colour: event.target.value })}
                />
              </div>
            ) : null}
          </fieldset>
        </form>
      </Modal>

      <Modal
        open={Boolean(checkoutVisit)}
        onClose={() => setCheckoutVisit(null)}
        title="Check out guest"
        description={
          checkoutVisit
            ? `${checkoutVisit.guest.fullName}${checkoutVisit.activeParking ? ` · parked in ${checkoutVisit.activeParking.bayCode}` : ''}`
            : undefined
        }
        footer={
          <>
            <Button variant="outlined" onClick={() => setCheckoutVisit(null)}>
              Cancel
            </Button>
            <Button
              loading={checkOut.isPending}
              onClick={() =>
                checkoutVisit &&
                checkOut.mutate({
                  visitId: checkoutVisit.id,
                  release: releaseParking,
                  note: checkoutNote,
                })
              }
            >
              Check out
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {checkoutVisit?.activeParking ? (
            <label className="flex min-h-12 items-center gap-3 rounded-md bg-cloud px-3 text-body-sm text-ink">
              <input
                type="checkbox"
                checked={releaseParking}
                onChange={(event) => setReleaseParking(event.target.checked)}
              />
              Release bay {checkoutVisit.activeParking.bayCode} ·{' '}
              {checkoutVisit.activeParking.areaName}
            </label>
          ) : null}
          <Textarea
            label="Note"
            value={checkoutNote}
            onChange={(event) => setCheckoutNote(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={newGuestOpen}
        onClose={() => setNewGuestOpen(false)}
        title="New guest"
        footer={
          <>
            <Button variant="outlined" onClick={() => setNewGuestOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createGuest.isPending}
              disabled={!newGuest.fullName}
              onClick={() => createGuest.mutate()}
            >
              Add guest
            </Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Full name"
            value={newGuest.fullName}
            onChange={(event) => setNewGuest({ ...newGuest, fullName: event.target.value })}
            required
          />
          <Input
            label="Company"
            value={newGuest.company}
            onChange={(event) => setNewGuest({ ...newGuest, company: event.target.value })}
          />
          <Input
            label="Phone"
            value={newGuest.phone}
            onChange={(event) => setNewGuest({ ...newGuest, phone: event.target.value })}
          />
          <Input
            label="ID / passport"
            value={newGuest.idNumber}
            onChange={(event) => setNewGuest({ ...newGuest, idNumber: event.target.value })}
          />
          <Input
            label="Email"
            type="email"
            value={newGuest.email}
            onChange={(event) => setNewGuest({ ...newGuest, email: event.target.value })}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(detailGuestId)}
        onClose={() => setDetailGuestId(null)}
        title={guestDetail.data?.guest.fullName ?? 'Guest detail'}
        description={guestDetail.data?.guest.company ?? undefined}
        size="lg"
      >
        {guestDetail.isLoading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : guestDetail.isError ? (
          <ErrorState title="Guest detail could not load." onRetry={() => guestDetail.refetch()} />
        ) : guestDetail.data ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <StatusPill tone={guestDetail.data.guest.active ? 'PRESENT' : 'INACTIVE'}>
                {guestDetail.data.guest.active ? 'ACTIVE' : 'INACTIVE'}
              </StatusPill>
              <Badge>{guestDetail.data.guest.visitCount ?? 0} visits</Badge>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Host</TH>
                  <TH>Purpose</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {guestDetail.data.visits.map((visit) => (
                  <TR key={visit.id}>
                    <TD>{formatDate(visit.checkedInAt ?? visit.expectedFrom)}</TD>
                    <TD>{visit.host.fullName}</TD>
                    <TD>{visit.purpose}</TD>
                    <TD>
                      <StatusPill status={visit.status}>{visit.status.replace('_', ' ')}</StatusPill>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
