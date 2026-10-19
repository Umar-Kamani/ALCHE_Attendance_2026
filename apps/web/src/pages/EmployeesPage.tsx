import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Employee, EmployeeListResponse, ImportBatchSummary } from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
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
  TH,
  THead,
  TR,
  useToast,
} from '../components/ui';
import { DownloadIcon, PlusIcon, SearchIcon, UploadIcon } from '../components/icons';

interface EmployeeForm {
  id?: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  category: 'staff' | 'contractor';
  active: boolean;
}

const emptyForm: EmployeeForm = {
  code: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  department: '',
  jobTitle: '',
  category: 'staff',
  active: true,
};

export function EmployeesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 250);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [department, setDepartment] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<EmployeeForm | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportBatchSummary | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const employees = useQuery({
    queryKey: ['employees', 'list', debounced, includeInactive, department, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        includeInactive: String(includeInactive),
      });
      if (debounced) params.set('q', debounced);
      if (department) params.set('department', department);
      return apiFetch<EmployeeListResponse>(`/employees?${params.toString()}`);
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form!.code,
        firstName: form!.firstName,
        lastName: form!.lastName,
        email: form!.email || null,
        phone: form!.phone || null,
        department: form!.department,
        jobTitle: form!.jobTitle || null,
        category: form!.category,
        active: form!.active,
      };
      return form!.id
        ? apiFetch<Employee>(`/employees/${form!.id}`, { method: 'PATCH', body })
        : apiFetch<Employee>('/employees', { method: 'POST', body });
    },
    onSuccess: async () => {
      toast.push({ title: form?.id ? 'Employee updated' : 'Employee created', tone: 'success' });
      setForm(null);
      setFieldErrors({});
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Employee could not be saved',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Employee>(`/employees/${id}`, { method: 'PATCH', body: { active: false } }),
    onSuccess: async () => {
      toast.push({ title: 'Employee deactivated', message: 'History is preserved.', tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (error) => {
      toast.push({
        title: 'Could not deactivate employee',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const dryRun = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const result = await apiFetch<ImportBatchSummary>('/employees/import?dryRun=true', {
        method: 'POST',
        body: formData,
      });
      setPreview(result);
    } catch (error) {
      setPreview(null);
      toast.push({
        title: 'Could not preview the file',
        message: error instanceof ApiError ? error.message : 'Check the CSV columns.',
        tone: 'error',
        duration: 9_000,
      });
    }
  };

  const commit = useMutation({
    mutationFn: async (skipInvalid: boolean) => {
      if (!file) throw new Error('Choose a file');
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch<ImportBatchSummary>(
        `/employees/import?dryRun=false&skipInvalid=${skipInvalid}`,
        { method: 'POST', body: formData },
      );
    },
    onSuccess: async (result) => {
      toast.push({
        title: 'Import complete',
        message: `${result.created} created · ${result.updated} updated · ${result.skipped} skipped.`,
        tone: 'success',
      });
      setImportOpen(false);
      setFile(null);
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (error) => {
      const details =
        error instanceof ApiError && error.details && typeof error.details === 'object'
          ? (error.details as { invalid?: unknown })
          : null;
      toast.push({
        title: 'Import stopped',
        message:
          error instanceof ApiError
            ? `${error.message}${details?.invalid ? ' See the invalid rows below.' : ''}`
            : 'The import failed.',
        tone: 'error',
        duration: 9_000,
      });
      if (error instanceof ApiError && error.details) {
        const summary = error.details as Partial<ImportBatchSummary> & {
          invalid?: Array<{ row: number; code?: string; message: string }>;
          preview?: ImportBatchSummary['preview'];
        };
        if (summary.invalid && summary.preview) {
          setPreview((current) =>
            current
              ? {
                  ...current,
                  errors: summary.invalid as ImportBatchSummary['errors'],
                  invalid: summary.invalid!.length,
                  preview: summary.preview!,
                }
              : current,
          );
        }
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    save.mutate();
  };

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Employees"
          description="The staff directory behind attendance and parking. Deactivate people instead of deleting them."
          actions={
            <>
              <Button variant="outlined" icon={<UploadIcon size={18} />} onClick={() => setImportOpen(true)}>
                Import CSV
              </Button>
              <Button
                icon={<PlusIcon size={18} />}
                onClick={() => {
                  setForm(emptyForm);
                  setFieldErrors({});
                }}
              >
                Add employee
              </Button>
            </>
          }
        />
        <Card>
          <div className="grid gap-4 md:grid-cols-3">
            <Input
              label="Search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name, code, email, department"
              suffix={<SearchIcon size={20} />}
            />
            <Select
              label="Department"
              value={department}
              onChange={(event) => {
                setDepartment(event.target.value);
                setPage(1);
              }}
              placeholder="All departments"
              options={(employees.data?.departments ?? []).map((value) => ({
                value,
                label: value,
              }))}
            />
            <Select
              label="Status"
              value={includeInactive ? 'all' : 'active'}
              onChange={(event) => {
                setIncludeInactive(event.target.value === 'all');
                setPage(1);
              }}
              options={[
                { value: 'active', label: 'Active only' },
                { value: 'all', label: 'Include inactive' },
              ]}
            />
          </div>
        </Card>
      </div>

      {employees.isLoading ? (
        <Card>
          <TableSkeleton rows={8} columns={6} />
        </Card>
      ) : employees.isError ? (
        <ErrorState title="Employees could not load." onRetry={() => employees.refetch()} />
      ) : employees.data?.items.length === 0 ? (
        <EmptyState
          title="No employees match this search."
          description="Add a person, or import the HR spreadsheet."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Department</TH>
                <TH>Job title</TH>
                <TH>Contact</TH>
                <TH>Category</TH>
                <TH>Status</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {employees.data?.items.map((employee) => (
                <TR key={employee.id}>
                  <TD>
                    <span className="font-medium text-ink">{employee.fullName}</span>
                    <span className="block text-caption text-slate">{employee.code}</span>
                  </TD>
                  <TD>{employee.department}</TD>
                  <TD>{employee.jobTitle ?? '—'}</TD>
                  <TD>
                    {employee.email ?? '—'}
                    <span className="block text-caption text-slate">{employee.phone ?? ''}</span>
                  </TD>
                  <TD>
                    <Badge>{employee.category}</Badge>
                  </TD>
                  <TD>
                    <StatusPill tone={employee.active ? 'PRESENT' : 'INACTIVE'}>
                      {employee.active ? 'ACTIVE' : 'INACTIVE'}
                    </StatusPill>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="text"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: employee.id,
                            code: employee.code,
                            firstName: employee.firstName,
                            lastName: employee.lastName,
                            email: employee.email ?? '',
                            phone: employee.phone ?? '',
                            department: employee.department,
                            jobTitle: employee.jobTitle ?? '',
                            category: employee.category,
                            active: employee.active,
                          });
                          setFieldErrors({});
                        }}
                      >
                        Edit
                      </Button>
                      {employee.active ? (
                        <Button
                          variant="text"
                          size="sm"
                          loading={deactivate.isPending}
                          onClick={() => deactivate.mutate(employee.id)}
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
          <Pagination
            page={employees.data?.meta.page ?? 1}
            totalPages={employees.data?.meta.totalPages ?? 1}
            onPage={setPage}
          />
        </Card>
      )}

      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit employee' : 'Add employee'}
        size="lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="employee-form"
              loading={save.isPending}
              disabled={!form?.code || !form?.firstName || !form?.lastName || !form?.department}
            >
              Save employee
            </Button>
          </>
        }
      >
        {form ? (
          <form id="employee-form" className="space-y-4" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Employee code"
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                error={fieldErrors.code}
                hint="2–32 letters or numbers."
                required
              />
              <Select
                label="Category"
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value as EmployeeForm['category'] })
                }
                options={[
                  { value: 'staff', label: 'Staff' },
                  { value: 'contractor', label: 'Contractor' },
                ]}
              />
              <Input
                label="First name"
                value={form.firstName}
                onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                error={fieldErrors.firstName}
                required
              />
              <Input
                label="Last name"
                value={form.lastName}
                onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                error={fieldErrors.lastName}
                required
              />
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                error={fieldErrors.email}
              />
              <Input
                label="Phone"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
              <Input
                label="Department"
                value={form.department}
                onChange={(event) => setForm({ ...form, department: event.target.value })}
                error={fieldErrors.department}
                required
              />
              <Input
                label="Job title"
                value={form.jobTitle}
                onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
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
          </form>
        ) : null}
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setFile(null);
          setPreview(null);
        }}
        title="Import employees"
        description="Preview first. Re-uploading the same file updates by employee_code, never duplicates."
        size="xl"
        footer={
          <>
            <Button
              variant="outlined"
              onClick={() => {
                setImportOpen(false);
                setFile(null);
                setPreview(null);
              }}
            >
              Close
            </Button>
            <Button
              variant="outlined"
              disabled={!preview || preview.invalid === 0 || commit.isPending}
              onClick={() => commit.mutate(true)}
            >
              Import valid rows only
            </Button>
            <Button
              disabled={!preview || preview.invalid > 0 || commit.isPending}
              loading={commit.isPending}
              onClick={() => commit.mutate(false)}
            >
              Import all rows
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="CSV file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
            }}
            hint="Required columns: employee_code, first_name, last_name, department."
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outlined"
              icon={<DownloadIcon size={18} />}
              disabled={!file}
              loading={commit.isPending}
              onClick={dryRun}
            >
              Preview file
            </Button>
            <span className="self-center text-body-sm text-slate">
              {file ? file.name : 'No file selected'}
            </span>
          </div>
          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge>{preview.totalRows} rows</Badge>
                <StatusPill tone="PRESENT">{preview.created} create</StatusPill>
                <StatusPill tone="ON_SITE">{preview.updated} update</StatusPill>
                <StatusPill tone={preview.invalid ? 'ERROR' : 'INACTIVE'}>
                  {preview.invalid} invalid
                </StatusPill>
              </div>
              {preview.invalid > 0 ? (
                <div className="rounded-md bg-error-surface p-3 text-body-sm text-error-ink">
                  {preview.errors.map((error) => (
                    <p key={`${error.row}-${error.message}`}>
                      Row {error.row}: {error.message}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="max-h-72 overflow-auto rounded-md border border-mist">
                <Table>
                  <THead>
                    <TR>
                      <TH>Row</TH>
                      <TH>Code</TH>
                      <TH>Name</TH>
                      <TH>Action</TH>
                      <TH>Reason</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {preview.preview.map((row) => (
                      <TR key={`${row.row}-${row.code}`}>
                        <TD>{row.row}</TD>
                        <TD>{row.code || '—'}</TD>
                        <TD>{row.name || '—'}</TD>
                        <TD>
                          <StatusPill
                            tone={
                              row.action === 'invalid'
                                ? 'ERROR'
                                : row.action === 'update'
                                  ? 'ON_SITE'
                                  : 'PRESENT'
                            }
                          >
                            {row.action}
                          </StatusPill>
                        </TD>
                        <TD>{row.reason ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
