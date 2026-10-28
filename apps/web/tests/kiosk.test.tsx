import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../src/components/ui';

const apiFetch = vi.fn();

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      username: 'gate',
      displayName: 'Gate Officer',
      role: 'SECURITY',
      mustChangePassword: false,
      active: true,
    },
    isLoading: false,
    refresh: vi.fn(),
    signOutLocal: vi.fn(),
  }),
}));

import { KioskPage } from '../src/pages/KioskPage';

function wrapper(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const employee = {
  kind: 'employee' as const,
  id: 'employee-1',
  code: 'ALCHE001',
  fullName: 'Nadia Bossy',
  department: 'Administration',
  category: 'staff' as const,
  active: true,
  currentState: {
    onCampus: true,
    since: '2026-10-19T04:14:00.000Z',
    lastDirection: 'IN' as const,
    lastOccurredAt: '2026-10-19T04:14:00.000Z',
  },
  vehicles: [],
};

describe('kiosk', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('infers OUT from an open IN and blocks a second submit while the first is in flight', async () => {
    let resolveEvent: ((value: unknown) => void) | undefined;
    const eventPromise = new Promise((resolve) => {
      resolveEvent = resolve;
    });
    let eventCalls = 0;

    apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === '/kiosk/activity') {
        return Promise.resolve({ items: [], onCampusCount: 1, today: '2026-10-19' });
      }
      if (path === '/kiosk/employees') {
        return Promise.resolve({ employees: [employee] });
      }
      if (path.startsWith('/kiosk/search')) {
        return Promise.resolve({ employees: [employee] });
      }
      if (path === '/events' && init?.method === 'POST') {
        eventCalls += 1;
        return eventPromise;
      }
      return Promise.resolve({});
    });

    render(wrapper(<KioskPage />));

    fireEvent.change(screen.getByRole('combobox', { name: 'Search employees and vehicles' }), {
      target: { value: 'Nadia' },
    });
    const result = await screen.findByRole('option', { name: /Nadia Bossy/ }, { timeout: 3000 });
    fireEvent.click(result);

    const action = await screen.findByRole('button', { name: /Mark OUT/ });
    fireEvent.click(action);

    await waitFor(() => expect(action).toBeDisabled());
    expect(eventCalls).toBe(1);
    fireEvent.click(action);
    expect(eventCalls).toBe(1);

    resolveEvent?.({
      event: {
        id: 'event-1',
        employeeId: 'employee-1',
        employeeName: 'Nadia Bossy',
        employeeCode: 'ALCHE001',
        occurredAt: new Date().toISOString(),
        direction: 'OUT',
        source: 'gate',
        note: null,
        recordedBy: 'Gate Officer',
        supersededById: null,
        voidedAt: null,
        ticketId: null,
        createdAt: new Date().toISOString(),
      },
      inferredDirection: 'OUT',
      undoUntil: new Date(Date.now() + 300_000).toISOString(),
      employeeState: { onCampus: false, since: null },
    });

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/events',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ employeeId: 'employee-1', direction: 'OUT' }),
        }),
      ),
    );
  });
});
