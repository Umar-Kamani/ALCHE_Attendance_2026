import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../src/components/ui/Modal';

function EditingHarness() {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Add record">
      <input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} />
    </Modal>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Modal focus management', () => {
  it('focuses the first form field instead of the close button', async () => {
    vi.useFakeTimers();
    render(<EditingHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('keeps focus in a field while the parent re-renders with a new onClose callback', async () => {
    vi.useFakeTimers();
    render(<EditingHarness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });

    const input = screen.getByRole('textbox', { name: 'Name' });
    input.focus();
    fireEvent.change(input, { target: { value: 'A' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });

    expect(input).toHaveFocus();
    expect(input).toHaveValue('A');
  });
});
