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

import { ParkingBoardPage } from '../src/pages/ParkingBoardPage';

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

const board = {
  areas: [
    {
      id: 'area-1',
      name: 'Main Lot',
      code: 'MAIN',
      counts: {
        overall: { total: 2, occupied: 1, free: 1 },
        byType: {
          STAFF: { total: 1, occupied: 0, free: 1 },
          GENERAL: { total: 1, occupied: 1, free: 0 },
        },
      },
      bays: [
        {
          id: 'bay-staff',
          code: 'A-01',
          bayType: 'STAFF',
          chip: 'S',
          active: true,
          notes: null,
          session: null,
        },
        {
          id: 'bay-general',
          code: 'A-02',
          bayType: 'GENERAL',
          chip: 'Gen',
          active: true,
          notes: null,
          session: {
            id: 'session-1',
            bayId: 'bay-general',
            bayCode: 'A-02',
            areaId: 'area-1',
            areaName: 'Main Lot',
            vehicleId: 'vehicle-1',
            plate: 'AB 1234',
            holderName: 'Nadia Bossy',
            holderCategory: 'employee',
            vehicleType: 'car',
            startedAt: '2026-10-19T04:00:00.000Z',
            allocatedBy: 'Gate Officer',
            overrideReason: null,
            isOverride: false,
            note: null,
          },
        },
      ],
    },
  ],
  counts: {
    overall: { total: 2, occupied: 1, free: 1 },
    byType: {
      STAFF: { total: 1, occupied: 0, free: 1 },
      GENERAL: { total: 1, occupied: 1, free: 0 },
    },
  },
  legend: [
    { type: 'STAFF', label: 'Staff', chip: 'S' },
    { type: 'STUDENT', label: 'Student', chip: 'St' },
    { type: 'GUEST', label: 'Guest', chip: 'G' },
    { type: 'GENERAL', label: 'General', chip: 'Gen' },
    { type: 'ACCESSIBLE', label: 'Accessible', chip: 'Acc' },
    { type: 'MOTORBIKE', label: 'Motorbike', chip: 'M' },
  ],
};

const studentVehicle = {
  id: 'vehicle-student',
  plate: 'ST 2026',
  plateNorm: 'ST2026',
  make: 'Toyota',
  model: 'Vitz',
  colour: 'Black',
  vehicleType: 'car',
  active: true,
  notes: null,
  holder: { kind: 'student', id: 'student-1', name: 'Aisha Peerboccus' },
  activeParking: null,
  lastSeenAt: null,
  createdAt: '2026-10-19T04:00:00.000Z',
  updatedAt: '2026-10-19T04:00:00.000Z',
};

describe('parking board', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('renders free and occupied bays and requires a reason for an ineligible bay type', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/parking/board')) return Promise.resolve(board);
      if (path.startsWith('/vehicles')) {
        return Promise.resolve({
          items: [studentVehicle],
          meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
        });
      }
      return Promise.resolve({});
    });

    render(wrapper(<ParkingBoardPage />));

    expect(await screen.findByLabelText('A-01, Staff bay, free')).toBeInTheDocument();
    expect(screen.getByText('AB 1234')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('A-01, Staff bay, free'));
    const search = await screen.findByLabelText('Find vehicle or holder');
    fireEvent.change(search, { target: { value: 'ST 2026' } });
    const result = await screen.findByRole(
      'button',
      { name: /ST 2026.*Aisha Peerboccus/s },
      { timeout: 3000 },
    );
    fireEvent.click(result);

    const reason = await screen.findByLabelText(/Override reason/);
    const allocate = screen.getByRole('button', { name: 'Allocate' });
    expect(reason).toBeInTheDocument();
    expect(allocate).toBeDisabled();

    fireEvent.change(reason, { target: { value: 'Student overflow approved by security supervisor' } });
    await waitFor(() => expect(allocate).toBeEnabled());
  });
});
