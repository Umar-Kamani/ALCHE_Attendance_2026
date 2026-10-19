import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BayType, ParkingArea, ParkingBay } from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
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
import { PlusIcon } from '../components/icons';

const BAY_TYPES: Array<{ value: BayType; label: string }> = [
  { value: 'STAFF', label: 'Staff' },
  { value: 'STUDENT', label: 'Student' },
  { value: 'GUEST', label: 'Guest' },
  { value: 'GENERAL', label: 'General' },
  { value: 'ACCESSIBLE', label: 'Accessible' },
  { value: 'MOTORBIKE', label: 'Motorbike' },
];

interface AreaForm {
  id?: string;
  name: string;
  code: string;
  notes: string;
  active: boolean;
}

interface BayForm {
  id?: string;
  areaId: string;
  code: string;
  bayType: BayType;
  notes: string;
  active: boolean;
}

interface BulkState {
  areaId: string;
  prefix: string;
  from: string;
  to: string;
  padding: string;
  bayType: BayType;
  preview: string[];
  skipped: string[];
  dryRun: boolean;
}

const emptyArea: AreaForm = { name: '', code: '', notes: '', active: true };
const emptyBay: BayForm = {
  areaId: '',
  code: '',
  bayType: 'GENERAL',
  notes: '',
  active: true,
};
const emptyBulk: BulkState = {
  areaId: '',
  prefix: 'A-',
  from: '1',
  to: '30',
  padding: '2',
  bayType: 'STAFF',
  preview: [],
  skipped: [],
  dryRun: true,
};

export function ParkingBaysPage() {
  const { user } = useAuth();
  const canWrite = user?.role === 'SECURITY';
  const queryClient = useQueryClient();
  const toast = useToast();
  const [areaFilter, setAreaFilter] = useState('');
  const [areaForm, setAreaForm] = useState<AreaForm | null>(null);
  const [bayForm, setBayForm] = useState<BayForm | null>(null);
  const [bulk, setBulk] = useState<BulkState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const areas = useQuery({
    queryKey: ['parking', 'areas'],
    queryFn: () => apiFetch<{ items: ParkingArea[] }>('/parking/areas'),
  });
  const bays = useQuery({
    queryKey: ['parking', 'bays', areaFilter],
    queryFn: () =>
      apiFetch<{ items: ParkingBay[] }>(
        `/parking/bays?includeInactive=true${areaFilter ? `&areaId=${areaFilter}` : ''}`,
      ),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['parking'] }),
      queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
    ]);
  };

  const saveArea = useMutation({
    mutationFn: () => {
      const body = {
        name: areaForm!.name,
        code: areaForm!.code,
        notes: areaForm!.notes || null,
        active: areaForm!.active,
      };
      return areaForm!.id
        ? apiFetch(`/parking/areas/${areaForm!.id}`, { method: 'PATCH', body })
        : apiFetch('/parking/areas', { method: 'POST', body });
    },
    onSuccess: async () => {
      toast.push({ title: areaForm?.id ? 'Area updated' : 'Area created', tone: 'success' });
      setAreaForm(null);
      setFieldErrors({});
      await refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Area could not be saved',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const saveBay = useMutation({
    mutationFn: () => {
      const body = {
        code: bayForm!.code,
        bayType: bayForm!.bayType,
        notes: bayForm!.notes || null,
        active: bayForm!.active,
      };
      return bayForm!.id
        ? apiFetch(`/parking/bays/${bayForm!.id}`, { method: 'PATCH', body })
        : apiFetch('/parking/bays', {
            method: 'POST',
            body: { ...body, areaId: bayForm!.areaId },
          });
    },
    onSuccess: async () => {
      toast.push({ title: bayForm?.id ? 'Bay updated' : 'Bay created', tone: 'success' });
      setBayForm(null);
      setFieldErrors({});
      await refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Bay could not be saved',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const runBulk = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<{ preview: string[]; skipped: string[]; created: ParkingBay[]; dryRun: boolean }>(
        '/parking/bays/bulk',
        {
          method: 'POST',
          body: {
            areaId: bulk!.areaId,
            prefix: bulk!.prefix,
            from: Number(bulk!.from),
            to: Number(bulk!.to),
            padding: Number(bulk!.padding),
            bayType: bulk!.bayType,
            dryRun,
          },
        },
      ),
    onSuccess: async (data) => {
      setBulk((current) =>
        current
          ? {
              ...current,
              preview: data.preview,
              skipped: data.skipped,
              dryRun: data.dryRun,
            }
          : current,
      );
      if (!data.dryRun) {
        toast.push({
          title: `${data.created.length} bays created`,
          message: data.skipped.length ? `${data.skipped.length} existing code(s) skipped.` : undefined,
          tone: 'success',
        });
        await refresh();
      }
    },
    onError: (error) => {
      toast.push({
        title: 'Bulk create failed',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const deactivateBay = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/parking/bays/${id}`, { method: 'PATCH', body: { active: false } }),
    onSuccess: async () => {
      toast.push({ title: 'Bay deactivated', tone: 'success' });
      await refresh();
    },
    onError: (error) => {
      toast.push({
        title: 'Could not deactivate the bay',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const deactivateArea = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/parking/areas/${id}`, { method: 'PATCH', body: { active: false } }),
    onSuccess: async () => {
      toast.push({ title: 'Area deactivated', tone: 'success' });
      await refresh();
    },
    onError: (error) => {
      toast.push({
        title: 'Could not deactivate the area',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const submitArea = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    saveArea.mutate();
  };
  const submitBay = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    saveBay.mutate();
  };

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Bay inventory"
          description={
            canWrite
              ? 'Areas and typed bays. Bay typing is the reservation model; GENERAL is the flexible pool.'
              : 'Read-only inventory for HR. Security maintains the physical bay list.'
          }
          actions={
            canWrite ? (
              <>
                <Button
                  variant="outlined"
                  icon={<PlusIcon size={18} />}
                  onClick={() => {
                    setAreaForm(emptyArea);
                    setFieldErrors({});
                  }}
                >
                  Add area
                </Button>
                <Button
                  icon={<PlusIcon size={18} />}
                  onClick={() => {
                    setBulk({ ...emptyBulk, areaId: areaFilter || areas.data?.items[0]?.id || '' });
                    setFieldErrors({});
                  }}
                >
                  Bulk create bays
                </Button>
              </>
            ) : undefined
          }
        />
      </div>

      {areas.isLoading ? (
        <Card>
          <TableSkeleton rows={3} columns={4} />
        </Card>
      ) : areas.isError ? (
        <ErrorState title="Areas could not load." onRetry={() => areas.refetch()} />
      ) : areas.data?.items.length === 0 ? (
        <EmptyState
          title="No parking areas yet."
          description={
            canWrite
              ? 'Create an area first, then add or bulk-create its bays.'
              : 'Security has not created any parking areas yet.'
          }
          action={
            canWrite ? (
              <Button
                icon={<PlusIcon size={18} />}
                onClick={() => {
                  setAreaForm(emptyArea);
                  setFieldErrors({});
                }}
              >
                Add area
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {areas.data?.items.map((area) => (
            <Card key={area.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-subheading font-medium text-ink">{area.name}</h2>
                  <p className="text-caption text-slate">
                    {area.code} · {area.bayCount ?? 0} bays
                  </p>
                </div>
                <StatusPill tone={area.active ? 'PRESENT' : 'INACTIVE'}>
                  {area.active ? 'ACTIVE' : 'INACTIVE'}
                </StatusPill>
              </div>
              <p className="mt-3 text-body-sm text-slate">
                {area.live ? `${area.live.occupied} occupied · ${area.live.free} free` : 'No capacity yet'}
              </p>
              {area.notes ? <p className="mt-2 text-body-sm text-slate">{area.notes}</p> : null}
              {canWrite ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outlined"
                    size="sm"
                    onClick={() => {
                      setAreaForm({
                        id: area.id,
                        name: area.name,
                        code: area.code,
                        notes: area.notes ?? '',
                        active: area.active,
                      });
                      setFieldErrors({});
                    }}
                  >
                    Edit
                  </Button>
                  {area.active ? (
                    <Button
                      variant="text"
                      size="sm"
                      loading={deactivateArea.isPending}
                      onClick={() => deactivateArea.mutate(area.id)}
                    >
                      Deactivate
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title="Bays"
          description="Live occupancy is shown beside every code. Inactive bays remain in history."
          action={
            canWrite ? (
              <Button
                icon={<PlusIcon size={18} />}
                onClick={() => {
                  setBayForm({
                    ...emptyBay,
                    areaId: areaFilter || areas.data?.items[0]?.id || '',
                  });
                  setFieldErrors({});
                }}
              >
                Add bay
              </Button>
            ) : undefined
          }
        />
        <div className="mb-4 max-w-sm">
          <Select
            label="Filter by area"
            value={areaFilter}
            onChange={(event) => setAreaFilter(event.target.value)}
            placeholder="All areas"
            options={(areas.data?.items ?? []).map((area) => ({
              value: area.id,
              label: area.name,
            }))}
          />
        </div>
        {bays.isLoading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : bays.isError ? (
          <ErrorState title="Bays could not load." onRetry={() => bays.refetch()} />
        ) : bays.data?.items.length === 0 ? (
          <EmptyState
            title="No bays in this area."
            description="Use Add bay or Bulk create to build the parking grid."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Area</TH>
                <TH>Type</TH>
                <TH>Occupancy</TH>
                <TH>Status</TH>
                <TH>Notes</TH>
                {canWrite ? <TH>Actions</TH> : null}
              </TR>
            </THead>
            <TBody>
              {bays.data?.items.map((bay) => (
                <TR key={bay.id}>
                  <TD className="font-medium text-ink">{bay.code}</TD>
                  <TD>{bay.areaName}</TD>
                  <TD>
                    <Badge>
                      {bay.chip} · {bay.bayType}
                    </Badge>
                  </TD>
                  <TD>
                    {bay.occupied ? (
                      <StatusPill tone="ON_SITE">OCCUPIED</StatusPill>
                    ) : (
                      <StatusPill tone="PRESENT">FREE</StatusPill>
                    )}
                  </TD>
                  <TD>
                    <StatusPill tone={bay.active ? 'PRESENT' : 'INACTIVE'}>
                      {bay.active ? 'ACTIVE' : 'INACTIVE'}
                    </StatusPill>
                  </TD>
                  <TD>{bay.notes ?? '—'}</TD>
                  {canWrite ? (
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="text"
                          size="sm"
                          onClick={() => {
                            setBayForm({
                              id: bay.id,
                              areaId: bay.areaId,
                              code: bay.code,
                              bayType: bay.bayType,
                              notes: bay.notes ?? '',
                              active: bay.active,
                            });
                            setFieldErrors({});
                          }}
                        >
                          Edit
                        </Button>
                        {bay.active ? (
                          <Button
                            variant="text"
                            size="sm"
                            loading={deactivateBay.isPending}
                            onClick={() => deactivateBay.mutate(bay.id)}
                          >
                            Deactivate
                          </Button>
                        ) : null}
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={Boolean(areaForm)}
        onClose={() => setAreaForm(null)}
        title={areaForm?.id ? 'Edit area' : 'Add parking area'}
        footer={
          <>
            <Button variant="outlined" onClick={() => setAreaForm(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="area-form"
              loading={saveArea.isPending}
              disabled={!areaForm?.name || !areaForm?.code}
            >
              Save area
            </Button>
          </>
        }
      >
        {areaForm ? (
          <form id="area-form" className="space-y-4" onSubmit={submitArea}>
            <Input
              label="Name"
              value={areaForm.name}
              onChange={(event) => setAreaForm({ ...areaForm, name: event.target.value })}
              error={fieldErrors.name}
              required
            />
            <Input
              label="Code"
              value={areaForm.code}
              onChange={(event) => setAreaForm({ ...areaForm, code: event.target.value })}
              error={fieldErrors.code}
              required
            />
            <Textarea
              label="Notes"
              value={areaForm.notes}
              onChange={(event) => setAreaForm({ ...areaForm, notes: event.target.value })}
            />
            <Select
              label="Status"
              value={areaForm.active ? 'true' : 'false'}
              onChange={(event) =>
                setAreaForm({ ...areaForm, active: event.target.value === 'true' })
              }
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
            />
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(bayForm)}
        onClose={() => setBayForm(null)}
        title={bayForm?.id ? 'Edit bay' : 'Add bay'}
        description="An occupied bay cannot be retyped or deactivated. Release it first."
        footer={
          <>
            <Button variant="outlined" onClick={() => setBayForm(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="bay-form"
              loading={saveBay.isPending}
              disabled={!bayForm?.code || !bayForm?.areaId}
            >
              Save bay
            </Button>
          </>
        }
      >
        {bayForm ? (
          <form id="bay-form" className="space-y-4" onSubmit={submitBay}>
            <Select
              label="Area"
              value={bayForm.areaId}
              onChange={(event) => setBayForm({ ...bayForm, areaId: event.target.value })}
              options={(areas.data?.items ?? []).map((area) => ({
                value: area.id,
                label: area.name,
              }))}
              disabled={Boolean(bayForm.id)}
              error={fieldErrors.areaId}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Code"
                value={bayForm.code}
                onChange={(event) => setBayForm({ ...bayForm, code: event.target.value })}
                placeholder="A-01"
                error={fieldErrors.code}
                required
              />
              <Select
                label="Bay type"
                value={bayForm.bayType}
                onChange={(event) =>
                  setBayForm({ ...bayForm, bayType: event.target.value as BayType })
                }
                options={BAY_TYPES}
              />
            </div>
            <Textarea
              label="Notes"
              value={bayForm.notes}
              onChange={(event) => setBayForm({ ...bayForm, notes: event.target.value })}
            />
            <Select
              label="Status"
              value={bayForm.active ? 'true' : 'false'}
              onChange={(event) => setBayForm({ ...bayForm, active: event.target.value === 'true' })}
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
            />
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(bulk)}
        onClose={() => setBulk(null)}
        title="Bulk create bays"
        description="Existing codes are previewed and skipped, never treated as failures."
        size="lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setBulk(null)}>
              Cancel
            </Button>
            {bulk && bulk.dryRun ? (
              <Button
                loading={runBulk.isPending}
                onClick={() => runBulk.mutate(false)}
                disabled={!bulk.areaId || bulk.preview.length === 0}
              >
                Create {bulk.preview.length - bulk.skipped.length} bays
              </Button>
            ) : null}
          </>
        }
      >
        {bulk ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Area"
                value={bulk.areaId}
                onChange={(event) => setBulk({ ...bulk, areaId: event.target.value, preview: [], skipped: [] })}
                options={(areas.data?.items ?? []).map((area) => ({
                  value: area.id,
                  label: area.name,
                }))}
              />
              <Select
                label="Bay type"
                value={bulk.bayType}
                onChange={(event) => setBulk({ ...bulk, bayType: event.target.value as BayType })}
                options={BAY_TYPES}
              />
              <Input
                label="Prefix"
                value={bulk.prefix}
                onChange={(event) => setBulk({ ...bulk, prefix: event.target.value })}
                placeholder="A-"
              />
              <Input
                label="Zero padding"
                type="number"
                min={1}
                max={4}
                value={bulk.padding}
                onChange={(event) => setBulk({ ...bulk, padding: event.target.value })}
              />
              <Input
                label="From number"
                type="number"
                value={bulk.from}
                onChange={(event) => setBulk({ ...bulk, from: event.target.value })}
              />
              <Input
                label="To number"
                type="number"
                value={bulk.to}
                onChange={(event) => setBulk({ ...bulk, to: event.target.value })}
              />
            </div>
            <Button
              variant="outlined"
              loading={runBulk.isPending}
              onClick={() => runBulk.mutate(true)}
              disabled={!bulk.areaId}
            >
              Preview range
            </Button>
            {bulk.preview.length > 0 ? (
              <div className="rounded-md bg-cloud p-3 text-body-sm">
                <p className="font-medium text-ink">
                  {bulk.preview.length - bulk.skipped.length} new · {bulk.skipped.length} skipped
                </p>
                <p className="mt-2 break-words text-slate">{bulk.preview.join(', ')}</p>
                {bulk.skipped.length > 0 ? (
                  <p className="mt-2 text-slate">Already present: {bulk.skipped.join(', ')}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
