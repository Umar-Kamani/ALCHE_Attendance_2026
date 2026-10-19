import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportBatchSummary, Student, StudentListResponse } from '@alche/shared';
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
import { PlusIcon, SearchIcon, UploadIcon } from '../components/icons';

interface StudentForm {
  id?: string;
  studentId: string;
  firstName: string;
  lastName: string;
  email: string;
  programme: string;
  active: boolean;
}

const emptyForm: StudentForm = {
  studentId: '',
  firstName: '',
  lastName: '',
  email: '',
  programme: '',
  active: true,
};

export function StudentsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 250);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<StudentForm | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportBatchSummary | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const students = useQuery({
    queryKey: ['students', debounced, includeInactive, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        includeInactive: String(includeInactive),
      });
      if (debounced) params.set('q', debounced);
      return apiFetch<StudentListResponse>(`/students?${params.toString()}`);
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        studentId: form!.studentId,
        firstName: form!.firstName,
        lastName: form!.lastName,
        email: form!.email || null,
        programme: form!.programme || null,
        active: form!.active,
      };
      return form!.id
        ? apiFetch<Student>(`/students/${form!.id}`, { method: 'PATCH', body })
        : apiFetch<Student>('/students', { method: 'POST', body });
    },
    onSuccess: async () => {
      toast.push({ title: form?.id ? 'Student updated' : 'Student created', tone: 'success' });
      setForm(null);
      setFieldErrors({});
      await queryClient.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors());
      toast.push({
        title: 'Student could not be saved',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Student>(`/students/${id}`, { method: 'PATCH', body: { active: false } }),
    onSuccess: async () => {
      toast.push({ title: 'Student deactivated', tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (error) => {
      toast.push({
        title: 'Could not deactivate student',
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
      setPreview(
        await apiFetch<ImportBatchSummary>('/students/import?dryRun=true', {
          method: 'POST',
          body: formData,
        }),
      );
    } catch (error) {
      toast.push({
        title: 'Preview failed',
        message: error instanceof ApiError ? error.message : 'Check the CSV columns.',
        tone: 'error',
      });
    }
  };

  const commit = useMutation({
    mutationFn: async (skipInvalid: boolean) => {
      const formData = new FormData();
      formData.append('file', file!);
      return apiFetch<ImportBatchSummary>(
        `/students/import?dryRun=false&skipInvalid=${skipInvalid}`,
        { method: 'POST', body: formData },
      );
    },
    onSuccess: async (result) => {
      toast.push({
        title: 'Student import complete',
        message: `${result.created} created · ${result.updated} updated · ${result.invalid} invalid.`,
        tone: 'success',
      });
      setImportOpen(false);
      setFile(null);
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (error) => {
      toast.push({
        title: 'Import stopped',
        message: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'error',
      });
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
          title="Students"
          description="A minimal directory used only for parking eligibility. Student attendance is not tracked."
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
                Add student
              </Button>
            </>
          }
        />
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name, student ID, programme"
              suffix={<SearchIcon size={20} />}
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

      {students.isLoading ? (
        <Card>
          <TableSkeleton rows={7} columns={5} />
        </Card>
      ) : students.isError ? (
        <ErrorState title="Students could not load." onRetry={() => students.refetch()} />
      ) : students.data?.items.length === 0 ? (
        <EmptyState
          title="No students match this search."
          description="Add one, or import the student CSV."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Student</TH>
                <TH>Student ID</TH>
                <TH>Programme</TH>
                <TH>Email</TH>
                <TH>Status</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {students.data?.items.map((student) => (
                <TR key={student.id}>
                  <TD className="font-medium text-ink">{student.fullName}</TD>
                  <TD>{student.studentId}</TD>
                  <TD>{student.programme ?? '—'}</TD>
                  <TD>{student.email ?? '—'}</TD>
                  <TD>
                    <StatusPill tone={student.active ? 'PRESENT' : 'INACTIVE'}>
                      {student.active ? 'ACTIVE' : 'INACTIVE'}
                    </StatusPill>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="text"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: student.id,
                            studentId: student.studentId,
                            firstName: student.firstName,
                            lastName: student.lastName,
                            email: student.email ?? '',
                            programme: student.programme ?? '',
                            active: student.active,
                          });
                          setFieldErrors({});
                        }}
                      >
                        Edit
                      </Button>
                      {student.active ? (
                        <Button
                          variant="text"
                          size="sm"
                          loading={deactivate.isPending}
                          onClick={() => deactivate.mutate(student.id)}
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
            page={students.data?.meta.page ?? 1}
            totalPages={students.data?.meta.totalPages ?? 1}
            onPage={setPage}
          />
        </Card>
      )}

      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit student' : 'Add student'}
        footer={
          <>
            <Button variant="outlined" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="student-form"
              loading={save.isPending}
              disabled={!form?.studentId || !form?.firstName || !form?.lastName}
            >
              Save student
            </Button>
          </>
        }
      >
        {form ? (
          <form id="student-form" className="space-y-4" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Student ID"
                value={form.studentId}
                onChange={(event) => setForm({ ...form, studentId: event.target.value })}
                error={fieldErrors.studentId}
                required
              />
              <Input
                label="Programme"
                value={form.programme}
                onChange={(event) => setForm({ ...form, programme: event.target.value })}
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
        title="Import students"
        description="Preview first. Re-uploading the same file updates by student_id."
        size="lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            <Button
              variant="outlined"
              disabled={!preview || preview.invalid === 0 || commit.isPending}
              onClick={() => commit.mutate(true)}
            >
              Import valid only
            </Button>
            <Button
              disabled={!preview || preview.invalid > 0 || commit.isPending}
              loading={commit.isPending}
              onClick={() => commit.mutate(false)}
            >
              Import all
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
            hint="Required: student_id, first_name, last_name. Optional: email, programme, active."
          />
          <Button variant="outlined" disabled={!file} onClick={dryRun}>
            Preview file
          </Button>
          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
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
              <div className="max-h-64 overflow-auto rounded-md border border-mist">
                <Table>
                  <THead>
                    <TR>
                      <TH>Row</TH>
                      <TH>Code</TH>
                      <TH>Name</TH>
                      <TH>Action</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {preview.preview.map((row) => (
                      <TR key={`${row.row}-${row.code}`}>
                        <TD>{row.row}</TD>
                        <TD>{row.code}</TD>
                        <TD>{row.name}</TD>
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
