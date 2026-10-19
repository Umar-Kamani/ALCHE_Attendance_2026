import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditLog } from '@alche/shared';
import { ApiError, apiFetch } from '../lib/api';
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
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';
import { RefreshIcon } from '../components/icons';
import { formatDateTime } from '../lib/dates';

export function AuditPage() {
  const [entity, setEntity] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({ entity, actor, from, to });
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const users = useQuery({
    queryKey: ['users', 'audit-filter'],
    queryFn: () => apiFetch<{ items: Array<{ id: string; displayName: string; username: string }> }>('/users?page=1'),
  });

  const audit = useQuery({
    queryKey: ['audit', applied, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (applied.entity) params.set('entity', applied.entity);
      if (applied.actor) params.set('actor', applied.actor);
      if (applied.from) params.set('from', applied.from);
      if (applied.to) params.set('to', applied.to);
      return apiFetch<{
        items: AuditLog[];
        meta: { page: number; totalPages: number; total: number };
      }>(`/audit?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          title="Audit log"
          description="Append-only. Database triggers reject updates and deletes; no UI path can alter an entry."
          actions={
            <Button
              variant="outlined"
              icon={<RefreshIcon size={18} />}
              onClick={() => audit.refetch()}
            >
              Refresh
            </Button>
          }
        />
        <Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Input
              label="Entity type"
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
              placeholder="event, ticket, parking_session…"
            />
            <Select
              label="Actor"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="All actors"
              options={(users.data?.items ?? []).map((user) => ({
                value: user.id,
                label: `${user.displayName} (${user.username})`,
              }))}
            />
            <Input label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <Input label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            <div className="flex items-end gap-2">
              <Button
                onClick={() => {
                  setApplied({ entity, actor, from, to });
                  setPage(1);
                }}
              >
                Apply
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  setEntity('');
                  setActor('');
                  setFrom('');
                  setTo('');
                  setApplied({ entity: '', actor: '', from: '', to: '' });
                  setPage(1);
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {audit.isLoading ? (
        <Card>
          <TableSkeleton rows={8} columns={6} />
        </Card>
      ) : audit.isError ? (
        <ErrorState
          title="Audit entries could not load."
          description={audit.error instanceof ApiError ? audit.error.message : undefined}
          onRetry={() => audit.refetch()}
        />
      ) : audit.data?.items.length === 0 ? (
        <EmptyState
          title="No audit entries match these filters."
          description="Try a broader date range or clear the entity and actor filters."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH>Entity</TH>
                <TH>Reason</TH>
                <TH>IP</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {audit.data?.items.map((entry) => (
                <TR key={entry.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TD>
                  <TD>
                    {entry.actor?.displayName ?? 'System'}
                    <span className="block text-caption text-slate">
                      {entry.actor?.username ?? '—'}
                    </span>
                  </TD>
                  <TD>
                    <Badge>{entry.action}</Badge>
                  </TD>
                  <TD>
                    {entry.entityType}
                    <span className="block max-w-[180px] truncate text-caption text-slate">
                      {entry.entityId ?? '—'}
                    </span>
                  </TD>
                  <TD className="max-w-[220px]">{entry.reason ?? '—'}</TD>
                  <TD>{entry.ip ?? '—'}</TD>
                  <TD>
                    <Button variant="text" size="sm" onClick={() => setSelected(entry)}>
                      View
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={audit.data?.meta.page ?? 1}
            totalPages={audit.data?.meta.totalPages ?? 1}
            onPage={setPage}
          />
        </Card>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Audit entry"
        description={selected ? `${selected.action} · ${formatDateTime(selected.createdAt)}` : undefined}
        size="lg"
      >
        {selected ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-cloud p-3">
                <p className="text-caption uppercase tracking-caption text-slate">Actor</p>
                <p className="text-body-sm text-ink">
                  {selected.actor?.displayName ?? 'System'}
                </p>
              </div>
              <div className="rounded-md bg-cloud p-3">
                <p className="text-caption uppercase tracking-caption text-slate">Entity</p>
                <p className="text-body-sm text-ink">
                  {selected.entityType} · {selected.entityId ?? '—'}
                </p>
              </div>
            </div>
            <div>
              <p className="mb-1 text-caption uppercase tracking-caption text-slate">Before</p>
              <pre className="alche-scrollbar max-h-56 overflow-auto rounded-md bg-cloud p-3 text-caption text-ink">
                {JSON.stringify(selected.before ?? null, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-caption uppercase tracking-caption text-slate">After</p>
              <pre className="alche-scrollbar max-h-56 overflow-auto rounded-md bg-cloud p-3 text-caption text-ink">
                {JSON.stringify(selected.after ?? null, null, 2)}
              </pre>
            </div>
            {selected.reason ? (
              <p className="rounded-md bg-periwinkle px-3 py-2 text-body-sm text-ink">
                Reason: {selected.reason}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
