import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { deriveAttendanceDay, type DerivationEvent } from '../src/attendance.js';

const ZONE = 'Indian/Mauritius';

function at(local: string, direction: 'IN' | 'OUT', id = `${direction}-${local}`, source: 'gate' | 'amendment' | 'hr_edit' = 'gate'): DerivationEvent {
  return {
    id,
    direction,
    source,
    occurredAt: DateTime.fromISO(local, { zone: ZONE }).toUTC().toJSDate(),
  };
}

describe('attendance derivation', () => {
  const cases: Array<{
    name: string;
    date: string;
    events: DerivationEvent[];
    expected: {
      status: string;
      spanHours: number | null;
      netHours: number;
      visits: number;
      flags: string[];
    };
  }> = [
    {
      name: 'complete day',
      date: '2026-10-19',
      events: [at('2026-10-19T08:00:00', 'IN'), at('2026-10-19T17:00:00', 'OUT')],
      expected: { status: 'PRESENT', spanHours: 9, netHours: 9, visits: 1, flags: [] },
    },
    {
      name: 'entry only is on site',
      date: '2026-10-19',
      events: [at('2026-10-19T08:00:00', 'IN')],
      expected: { status: 'ON_SITE', spanHours: null, netHours: 0, visits: 0, flags: ['NO_EXIT'] },
    },
    {
      name: 'exit only is missing in',
      date: '2026-10-19',
      events: [at('2026-10-19T17:00:00', 'OUT')],
      expected: { status: 'MISSING_IN', spanHours: null, netHours: 0, visits: 0, flags: [] },
    },
    {
      name: 'no events is absent',
      date: '2026-10-19',
      events: [],
      expected: { status: 'ABSENT', spanHours: 0, netHours: 0, visits: 0, flags: [] },
    },
    {
      name: 'multiple visits compute span and net separately',
      date: '2026-10-19',
      events: [
        at('2026-10-19T08:00:00', 'IN', 'in-1'),
        at('2026-10-19T10:00:00', 'OUT', 'out-1'),
        at('2026-10-19T12:00:00', 'IN', 'in-2'),
        at('2026-10-19T16:00:00', 'OUT', 'out-2'),
      ],
      expected: { status: 'PRESENT', spanHours: 8, netHours: 6, visits: 2, flags: [] },
    },
    {
      name: 'midnight pair lands on the entry date and is overnight',
      date: '2026-10-18',
      events: [at('2026-10-18T23:50:00', 'IN'), at('2026-10-19T00:10:00', 'OUT')],
      expected: { status: 'PRESENT', spanHours: 0.33, netHours: 0.33, visits: 1, flags: ['OVERNIGHT'] },
    },
    {
      name: 'the closing overnight OUT does not become missing-in next day',
      date: '2026-10-19',
      events: [at('2026-10-18T23:50:00', 'IN'), at('2026-10-19T00:10:00', 'OUT')],
      expected: { status: 'ABSENT', spanHours: 0, netHours: 0, visits: 0, flags: [] },
    },
    {
      name: 'a past day with no exit is flagged',
      date: '2026-10-18',
      events: [at('2026-10-18T08:00:00', 'IN')],
      expected: { status: 'ON_SITE', spanHours: null, netHours: 0, visits: 0, flags: ['NO_EXIT'] },
    },
    {
      name: 'an amended day is flagged',
      date: '2026-10-19',
      events: [
        at('2026-10-19T08:00:00', 'IN', 'in-amended', 'amendment'),
        at('2026-10-19T17:00:00', 'OUT'),
      ],
      expected: {
        status: 'PRESENT',
        spanHours: 9,
        netHours: 9,
        visits: 1,
        flags: ['AMENDED'],
      },
    },
    {
      name: 'same direction twice within two minutes on an amended day is suspect',
      date: '2026-10-19',
      events: [
        at('2026-10-19T08:00:00', 'IN', 'in-1', 'amendment'),
        at('2026-10-19T08:01:00', 'IN', 'in-2'),
        at('2026-10-19T17:00:00', 'OUT'),
      ],
      expected: {
        status: 'PRESENT',
        spanHours: 9,
        netHours: 9,
        visits: 1,
        flags: ['AMENDED', 'DUPLICATE_SUSPECT'],
      },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = deriveAttendanceDay(testCase.events, testCase.date, '2026-10-20');
      expect(result.status).toBe(testCase.expected.status);
      expect(result.spanHours).toBe(testCase.expected.spanHours);
      expect(result.netHours).toBe(testCase.expected.netHours);
      expect(result.visits).toBe(testCase.expected.visits);
      expect(result.flags).toEqual(testCase.expected.flags);
      if (testCase.expected.status === 'ABSENT') {
        expect(result.spanHours).toBe(0);
      }
    });
  }

  it('uses the exit-date segment on the entry date across a month boundary', () => {
    const events = [at('2026-09-30T22:30:00', 'IN'), at('2026-10-01T06:00:00', 'OUT')];
    const september = deriveAttendanceDay(events, '2026-09-30', '2026-10-02');
    const october = deriveAttendanceDay(events, '2026-10-01', '2026-10-02');
    expect(september.status).toBe('PRESENT');
    expect(september.flags).toContain('OVERNIGHT');
    expect(october.status).toBe('ABSENT');
  });

  it('does not report future activity as no-exit', () => {
    const result = deriveAttendanceDay(
      [at('2026-10-19T08:00:00', 'IN')],
      '2026-10-19',
      '2026-10-19',
    );
    expect(result.flags).not.toContain('NO_EXIT');
  });
});
