import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OnCampusResponse } from '@alche/shared';
import { OnCampusPage } from '../src/pages/OnCampusPage';

const apiFetch = vi.fn();

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const response: OnCampusResponse = {
  generatedAt: '2026-10-28T06:00:00.000Z',
  employees: [
    {
      id: 'employee-1',
      code: 'ALCHE001',
      fullName: 'Nadia Bossy',
      department: 'Administration',
      since: '2026-10-28T04:00:00.000Z',
      elapsedMinutes: 120,
      vehicles: ['AB 1234'],
    },
  ],
};

describe('on-campus staff table', () => {
  it('shows only employee, since, elapsed and vehicles', async () => {
    apiFetch.mockResolvedValue(response);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <OnCampusPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Nadia Bossy')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Employee',
      'Since',
      'Elapsed',
      'Vehicles',
    ]);
    expect(screen.queryByText('Department')).not.toBeInTheDocument();
    expect(screen.getByText('AB 1234')).toBeInTheDocument();
  });
});
