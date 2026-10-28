import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KioskSearchResponse,
  Vehicle,
  VehicleDetail,
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
import { CarIcon, PlusIcon, SearchIcon } from '../components/icons';
import { formatDateTime, formatTime } from '../lib/dates';

interface VehicleForm {
  id?: string;
  holderKind: 'employee' | 'guest';
  holderId: string;
  holderName: string;
  plate: string;
  make: string;
  model: string;
  colour: string;
  vehicleType: 'car' | 'motorbike' | 'van' | 'other';
  notes: string;
  active: boolean;
}

const emptyForm: VehicleForm = {
  holderKind: 'employee',
  holderId: '',
  holderName: '',
  plate: '',
  make: '',
  model: '',
  colour: '',
  vehicleType: 'car',
  notes: '',
  active: true,
};

export function VehiclesPage() {
  const { user } = useAuth();
  const isHr = user?.role === 'HR';
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<VehicleForm>(emptyForm);
  const [holderSearch, setHolderSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const vehicles = useQuery({
    queryKey: ['vehicles', debounced, page],
    queryFn: () =>
      apiFetch<VehicleListResponse>(
        `/vehicles?page=${page}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`,
      ),
  });

  const holders = useQuery({
    queryKey: ['vehicles', 'holder-search', holderSearch],
    queryFn: () =>
      apiFetch<KioskSearchResponse>(`/kiosk/search?q=${encodeURIComponent(holderSearch.trim())}`),
    enabled: formOpen && holderSearch.trim().length >= 2 && !form.holderId,
  });

  const detail = useQuery({
    queryKey: ['vehicles', 'detail', detailId],
    queryFn: () => apiFetch<VehicleDetail>(`/vehicles/${detailId}`),
    enabled: Boolean(detailId),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        plate: form.plate,
        make: form.make || null,
        model: form.model || null,
        colour: form.colour || null,
        vehicleType: form.vehicleType,
        notes: form.notes || null,
        active: form.active,
      };
      if (form.id) {
        return apiFetch<Vehicle>(`/vehicles/${form.id}`, { method: 'PATCH', body });
      }
      return apiFetch<Vehicle>('/vehicles', {
        method: 'POST',
        body: {
          ...body,
          holderKind: form.holderKind,
          holderId: form.holderId,
        },
      });
    },
    onSuccess: async () => {
      toast.push({ title: form.id ? 'Vehicle updated' : 'Vehicle registered', tone: 'success' });
      setFormOpen(false);
      setForm(emptyForm);
      setHolderSearch('');
      setFieldErrors({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
        queryClient.invalidateQueries({ queryKey: ['parking'] }),
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Vehicle could not be saved',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const openCreate = () => {
    setForm(emptyForm);
    setHolderSearch('');
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (vehicle: Vehicle) => {
    setForm({
      id: vehicle.id,
      holderKind: vehicle.holder.kind === 'employee' ? 'employee' : 'guest',
      holderId: vehicle.holder.id,
      holderName: vehicle.holder.name,
      plate: vehicle.plate,
      make: vehicle.make ?? '',
      model: vehicle.model ?? '',
      colour: vehicle.colour ?? '',
      vehicleType: vehicle.vehicleType,
      notes: vehicle.notes ?? '',
      active: vehicle.active,
    });
    setFieldErrors({});
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    save.mutate();
  };

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Vehicles"
          description="One plate, one holder. Security can add a vehicle at the gate; HR maintains the full record."
          actions={
            <Button icon={<PlusIcon size={18} />} onClick={openCreate}>
              Add vehicle
            </Button>
          }
        />
        <Card>
          <Input
            label="Search by plate or holder"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="AB 1234, Priya, GU 9080…"
            suffix={<SearchIcon size={20} />}
          />
        </Card>
      </div>

      {vehicles.isLoading ? (
        <Card>
          <TableSkeleton rows={7} columns={6} />
        </Card>
      ) : vehicles.isError ? (
        <ErrorState
          title="Vehicles could not load."
          description={vehicles.error instanceof ApiError ? vehicles.error.message : undefined}
          onRetry={() => vehicles.refetch()}
        />
      ) : vehicles.data?.items.length === 0 ? (
        <EmptyState
          title="No vehicles match this search."
          description="Register a vehicle from here, or while checking someone in at the kiosk."
          action={
            <Button icon={<PlusIcon size={18} />} onClick={openCreate}>
              Add vehicle
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Plate</TH>
                <TH>Holder</TH>
                <TH>Vehicle</TH>
                <TH>Parking</TH>
                <TH>Last seen</TH>
                <TH>Status</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {vehicles.data?.items.map((vehicle) => (
                <TR key={vehicle.id}>
                  <TD>
                    <span className="inline-flex items-center gap-2 font-medium text-ink">
                      <CarIcon size={18} />
                      {vehicle.plate}
                    </span>
                    <span className="block text-caption text-slate">{vehicle.plateNorm}</span>
                  </TD>
                  <TD>
                    {vehicle.holder.name}
                    <span className="block text-caption text-slate">
                      {vehicle.holder.kind}
                    </span>
                  </TD>
                  <TD>
                    {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}
                    <span className="block text-caption text-slate">
                      {[vehicle.colour, vehicle.vehicleType].filter(Boolean).join(' · ')}
                    </span>
                  </TD>
                  <TD>
                    {vehicle.activeParking ? (
                      <StatusPill tone="ON_SITE">
                        {vehicle.activeParking.bayCode} · {vehicle.activeParking.areaName}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="INACTIVE">Not parked</StatusPill>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {vehicle.lastSeenAt ? formatDateTime(vehicle.lastSeenAt) : '—'}
                  </TD>
                  <TD>
                    <StatusPill tone={vehicle.active ? 'PRESENT' : 'INACTIVE'}>
                      {vehicle.active ? 'ACTIVE' : 'INACTIVE'}
                    </StatusPill>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="text" size="sm" onClick={() => setDetailId(vehicle.id)}>
                        View
                      </Button>
                      {isHr ? (
                        <Button variant="text" size="sm" onClick={() => openEdit(vehicle)}>
                          Edit
                        </Button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={vehicles.data?.meta.page ?? 1}
            totalPages={vehicles.data?.meta.totalPages ?? 1}
            onPage={setPage}
          />
        </Card>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? 'Edit vehicle' : 'Add vehicle'}
        description={
          form.id
            ? 'HR can change the full record. The holder cannot be moved between people.'
            : 'Register the vehicle against exactly one employee or guest.'
        }
        size="lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="vehicle-form"
              loading={save.isPending}
              disabled={!form.plate || (!form.id && !form.holderId)}
            >
              {form.id ? 'Save changes' : 'Register vehicle'}
            </Button>
          </>
        }
      >
        <form id="vehicle-form" onSubmit={submit} className="space-y-4">
          {!form.id ? (
            <>
              <Select
                label="Holder type"
                value={form.holderKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    holderKind: event.target.value as VehicleForm['holderKind'],
                    holderId: '',
                    holderName: '',
                  })
                }
                options={[
                  { value: 'employee', label: 'Employee' },
                  { value: 'guest', label: 'Guest' },
                ]}
              />
              <Input
                label="Find holder"
                value={form.holderId ? form.holderName : holderSearch}
                onChange={(event) => {
                  setHolderSearch(event.target.value);
                  setForm({ ...form, holderId: '', holderName: '' });
                }}
                placeholder="Search name or code"
                error={fieldErrors.holderId}
                required
              />
              {!form.holderId && holderSearch.trim().length >= 2 ? (
                <div className="max-h-56 overflow-y-auto rounded-md border border-mist">
                  {holders.isLoading ? (
                    <p className="p-3 text-body-sm text-slate">Searching…</p>
                  ) : (
                    <>
                      {(form.holderKind === 'employee'
                        ? holders.data?.employees ?? []
                        : holders.data?.guests ?? []
                      ).map((holder) => {
                        const name = holder.fullName;
                        return (
                          <button
                            key={holder.id}
                            type="button"
                            className="flex min-h-12 w-full items-center justify-between border-b border-mist px-3 text-left last:border-0 hover:bg-cloud"
                            onClick={() => {
                              setForm({
                                ...form,
                                holderId: holder.id,
                                holderName: name,
                              });
                              setHolderSearch(name);
                            }}
                          >
                            <span className="text-body-sm text-ink">{name}</span>
                            <Badge>{holder.kind}</Badge>
                          </button>
                        );
                      })}
                      {(form.holderKind === 'employee'
                        ? holders.data?.employees.length
                        : holders.data?.guests.length) === 0 ? (
                        <p className="p-3 text-body-sm text-slate">No matching holder.</p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <p className="rounded-md bg-cloud px-3 py-2 text-body-sm text-slate">
              Holder: <strong className="text-ink">{form.holderName}</strong>
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Plate"
              value={form.plate}
              onChange={(event) => setForm({ ...form, plate: event.target.value })}
              placeholder="AB 1234"
              error={fieldErrors.plate}
              required
            />
            <Select
              label="Vehicle type"
              value={form.vehicleType}
              onChange={(event) =>
                setForm({ ...form, vehicleType: event.target.value as VehicleForm['vehicleType'] })
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
              value={form.make}
              onChange={(event) => setForm({ ...form, make: event.target.value })}
            />
            <Input
              label="Model"
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
            />
            <Input
              label="Colour"
              value={form.colour}
              onChange={(event) => setForm({ ...form, colour: event.target.value })}
            />
            <Select
              label="Status"
              value={form.active ? 'true' : 'false'}
              onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
            />
          </div>
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </form>
      </Modal>

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detail.data ? `${detail.data.plate} · ${detail.data.holder.name}` : 'Vehicle detail'}
        description={
          detail.data
            ? [detail.data.make, detail.data.model, detail.data.colour]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        size="lg"
      >
        {detail.isLoading ? (
          <TableSkeleton rows={4} columns={4} />
        ) : detail.isError ? (
          <ErrorState title="Vehicle detail could not load." onRetry={() => detail.refetch()} />
        ) : detail.data ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <StatusPill tone={detail.data.active ? 'PRESENT' : 'INACTIVE'}>
                {detail.data.active ? 'ACTIVE' : 'INACTIVE'}
              </StatusPill>
              <Badge>{detail.data.holder.kind}</Badge>
              <Badge>{detail.data.vehicleType}</Badge>
              {detail.data.activeParking ? (
                <StatusPill tone="ON_SITE">
                  PARKED {detail.data.activeParking.bayCode} · {detail.data.activeParking.areaName}
                </StatusPill>
              ) : null}
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Bay</TH>
                  <TH>Started</TH>
                  <TH>Ended</TH>
                  <TH>Minutes</TH>
                  <TH>Override</TH>
                </TR>
              </THead>
              <TBody>
                {detail.data.history.length === 0 ? (
                  <TR>
                    <TD colSpan={5} className="text-slate">
                      No parking history yet.
                    </TD>
                  </TR>
                ) : (
                  detail.data.history.map((row) => (
                    <TR key={row.sessionId}>
                      <TD>
                        {row.bayCode}
                        <span className="block text-caption text-slate">{row.areaName}</span>
                      </TD>
                      <TD>{formatTime(row.startedAt)}</TD>
                      <TD>{row.endedAt ? formatTime(row.endedAt) : 'Active'}</TD>
                      <TD>{row.minutes ?? '—'}</TD>
                      <TD>{row.overrideReason ?? '—'}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
