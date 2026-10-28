import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KioskSearchResponse, Vehicle, VehicleListResponse } from '@alche/shared';
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
import { formatDateTime } from '../lib/dates';

interface VehicleForm {
  id?: string;
  employeeId: string;
  employeeName: string;
  plate: string;
  make: string;
  model: string;
  colour: string;
  vehicleType: 'car' | 'motorbike' | 'van' | 'other';
  notes: string;
  active: boolean;
}

const emptyForm: VehicleForm = {
  employeeId: '',
  employeeName: '',
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
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [detail, setDetail] = useState<Vehicle | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const vehicles = useQuery({
    queryKey: ['vehicles', debounced, page],
    queryFn: () =>
      apiFetch<VehicleListResponse>(
        `/vehicles?page=${page}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`,
      ),
  });

  const employees = useQuery({
    queryKey: ['vehicles', 'employee-search', employeeSearch],
    queryFn: () =>
      apiFetch<KioskSearchResponse>(`/kiosk/search?q=${encodeURIComponent(employeeSearch.trim())}`),
    enabled: formOpen && employeeSearch.trim().length >= 2 && !form.employeeId,
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
        body: { ...body, employeeId: form.employeeId },
      });
    },
    onSuccess: async () => {
      toast.push({
        title: form.id ? 'Vehicle updated' : 'Vehicle added',
        tone: 'success',
      });
      setFormOpen(false);
      setFieldErrors({});
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
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

  const deactivate = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/vehicles/${id}`, { method: 'PATCH', body: { active: false } }),
    onSuccess: async () => {
      toast.push({ title: 'Vehicle deactivated', tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (error) => {
      toast.push({
        title: 'Could not deactivate vehicle',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const openCreate = () => {
    setForm(emptyForm);
    setEmployeeSearch('');
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (vehicle: Vehicle) => {
    setForm({
      id: vehicle.id,
      employeeId: vehicle.holder.id,
      employeeName: vehicle.holder.name,
      plate: vehicle.plate,
      make: vehicle.make ?? '',
      model: vehicle.model ?? '',
      colour: vehicle.colour ?? '',
      vehicleType: vehicle.vehicleType,
      notes: vehicle.notes ?? '',
      active: vehicle.active,
    });
    setEmployeeSearch('');
    setFieldErrors({});
    setFormOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    save.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicles"
        description="Employees may have multiple vehicles. Number plates remain searchable at the kiosk."
        actions={
          <Button icon={<PlusIcon size={18} />} onClick={openCreate}>
            Add vehicle
          </Button>
        }
      />

      <Card>
        <div className="mb-4 max-w-md">
          <Input
            label="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Plate, employee name or code"
            suffix={<SearchIcon size={20} />}
          />
        </div>

        {vehicles.isLoading ? (
          <TableSkeleton rows={8} columns={5} />
        ) : vehicles.isError ? (
          <ErrorState title="Vehicles could not load." onRetry={() => vehicles.refetch()} />
        ) : vehicles.data?.items.length === 0 ? (
          <EmptyState
            title="No vehicles match this search."
            description="Add a vehicle and assign it to an employee."
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Vehicle</TH>
                  <TH>Employee</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {vehicles.data?.items.map((vehicle) => (
                  <TR key={vehicle.id}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <CarIcon size={18} />
                        <span>
                          <span className="block font-medium text-ink">{vehicle.plate}</span>
                          <span className="block text-caption text-slate">
                            {[vehicle.make, vehicle.model, vehicle.colour].filter(Boolean).join(' · ') ||
                              '—'}
                          </span>
                        </span>
                      </div>
                    </TD>
                    <TD>{vehicle.holder.name}</TD>
                    <TD>
                      <Badge>{vehicle.vehicleType}</Badge>
                    </TD>
                    <TD>
                      <StatusPill tone={vehicle.active ? 'PRESENT' : 'INACTIVE'}>
                        {vehicle.active ? 'ACTIVE' : 'INACTIVE'}
                      </StatusPill>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="text" size="sm" onClick={() => setDetail(vehicle)}>
                          View
                        </Button>
                        {isHr ? (
                          <>
                            <Button variant="text" size="sm" onClick={() => openEdit(vehicle)}>
                              Edit
                            </Button>
                            {vehicle.active ? (
                              <Button
                                variant="text"
                                size="sm"
                                loading={deactivate.isPending}
                                onClick={() => deactivate.mutate(vehicle.id)}
                              >
                                Deactivate
                              </Button>
                            ) : null}
                          </>
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
          </>
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? 'Edit vehicle' : 'Add vehicle'}
        description={
          form.id
            ? 'Update the vehicle record. Its employee cannot be changed.'
            : 'Register another vehicle for an employee.'
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
              disabled={!form.plate || (!form.id && !form.employeeId)}
            >
              {form.id ? 'Save changes' : 'Add vehicle'}
            </Button>
          </>
        }
      >
        <form id="vehicle-form" onSubmit={submit} className="space-y-4">
          {!form.id ? (
            <>
              <Input
                label="Find employee"
                value={form.employeeId ? form.employeeName : employeeSearch}
                onChange={(event) => {
                  setEmployeeSearch(event.target.value);
                  setForm({ ...form, employeeId: '', employeeName: '' });
                }}
                placeholder="Search name, code or department"
                error={fieldErrors.employeeId}
                required
              />
              {!form.employeeId && employeeSearch.trim().length >= 2 ? (
                <div className="max-h-56 overflow-y-auto rounded-md border border-mist">
                  {employees.isLoading ? (
                    <p className="p-3 text-body-sm text-slate">Searching…</p>
                  ) : (
                    <>
                      {(employees.data?.employees ?? []).map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          className="flex min-h-12 w-full items-center justify-between border-b border-mist px-3 text-left last:border-0 hover:bg-cloud"
                          onClick={() => {
                            setForm({
                              ...form,
                              employeeId: employee.id,
                              employeeName: employee.fullName,
                            });
                            setEmployeeSearch(employee.fullName);
                          }}
                        >
                          <span className="text-body-sm text-ink">{employee.fullName}</span>
                          <span className="text-caption text-slate">
                            {employee.code} · {employee.department}
                          </span>
                        </button>
                      ))}
                      {(employees.data?.employees.length ?? 0) === 0 ? (
                        <p className="p-3 text-body-sm text-slate">No matching employee.</p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <p className="rounded-md bg-cloud px-3 py-2 text-body-sm text-slate">
              Employee: <strong className="text-ink">{form.employeeName}</strong>
            </p>
          )}

          <Input
            label="Plate"
            value={form.plate}
            onChange={(event) => setForm({ ...form, plate: event.target.value })}
            error={fieldErrors.plate}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
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
              label="Type"
              value={form.vehicleType}
              onChange={(event) =>
                setForm({
                  ...form,
                  vehicleType: event.target.value as VehicleForm['vehicleType'],
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
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            rows={3}
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
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.plate ?? 'Vehicle'}
        description={detail?.holder.name}
      >
        {detail ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-cloud p-3">
                <p className="text-caption uppercase tracking-caption text-slate">Type</p>
                <p className="text-body-sm text-ink">{detail.vehicleType}</p>
              </div>
              <div className="rounded-md bg-cloud p-3">
                <p className="text-caption uppercase tracking-caption text-slate">Status</p>
                <p className="text-body-sm text-ink">{detail.active ? 'Active' : 'Inactive'}</p>
              </div>
              <div className="rounded-md bg-cloud p-3">
                <p className="text-caption uppercase tracking-caption text-slate">Make / model</p>
                <p className="text-body-sm text-ink">
                  {[detail.make, detail.model].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="rounded-md bg-cloud p-3">
                <p className="text-caption uppercase tracking-caption text-slate">Colour</p>
                <p className="text-body-sm text-ink">{detail.colour ?? '—'}</p>
              </div>
            </div>
            <div className="rounded-md bg-cloud p-3">
              <p className="text-caption uppercase tracking-caption text-slate">Notes</p>
              <p className="text-body-sm text-ink">{detail.notes ?? '—'}</p>
            </div>
            <p className="text-caption text-slate">Added {formatDateTime(detail.createdAt)}</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
