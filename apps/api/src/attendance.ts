import { DateTime } from 'luxon';
import type { AttendanceFlag, AttendanceStatus } from '@alche/shared';
import { APP_ZONE, currentLocalDate } from './time.js';

export interface DerivationEvent {
  id: string;
  occurredAt: Date;
  direction: 'IN' | 'OUT';
  source: 'gate' | 'amendment' | 'hr_edit';
}

export interface AttendanceDerivation {
  date: string;
  status: AttendanceStatus;
  firstIn: Date | null;
  lastOut: Date | null;
  spanHours: number | null;
  netHours: number;
  visits: number;
  flags: AttendanceFlag[];
  amended: boolean;
  firstInEventId: string | null;
  lastOutEventId: string | null;
}

interface Pair {
  inEvent: DerivationEvent;
  outEvent: DerivationEvent;
}

interface Timeline {
  completed: Pair[];
  openIn: DerivationEvent | null;
  extraIns: DerivationEvent[];
  exitOnly: DerivationEvent[];
}

function localDate(event: DerivationEvent): string {
  return DateTime.fromJSDate(event.occurredAt, { zone: 'utc' }).setZone(APP_ZONE).toISODate() ?? '';
}

function localDateTime(event: DerivationEvent): DateTime {
  return DateTime.fromJSDate(event.occurredAt, { zone: 'utc' }).setZone(APP_ZONE);
}

function buildTimeline(events: DerivationEvent[]): Timeline {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const completed: Pair[] = [];
  const extraIns: DerivationEvent[] = [];
  const exitOnly: DerivationEvent[] = [];
  let openIn: DerivationEvent | null = null;

  for (const event of sorted) {
    if (event.direction === 'IN') {
      // A duplicate IN must not discard the earlier unmatched IN: the earliest
      // IN still defines the day's first-in time and the duplicate is surfaced
      // as a flag on amended data.
      if (openIn) {
        extraIns.push(event);
      } else {
        openIn = event;
      }
      continue;
    }
    if (openIn) {
      completed.push({ inEvent: openIn, outEvent: event });
      openIn = null;
    } else {
      exitOnly.push(event);
    }
  }

  return { completed, openIn, extraIns, exitOnly };
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function pairMinutes(pair: Pair): number {
  return Math.max(0, pair.outEvent.occurredAt.getTime() - pair.inEvent.occurredAt.getTime()) / 60_000;
}

export function deriveAttendanceDay(
  allEvents: DerivationEvent[],
  reportDate: string,
  today = currentLocalDate(),
): AttendanceDerivation {
  const timeline = buildTimeline(allEvents);
  const assigned: DerivationEvent[] = [];

  for (const pair of timeline.completed) {
    if (localDate(pair.inEvent) === reportDate) {
      assigned.push(pair.inEvent, pair.outEvent);
    }
  }
  if (timeline.openIn && localDate(timeline.openIn) === reportDate) {
    assigned.push(timeline.openIn);
  }
  for (const event of timeline.extraIns) {
    if (localDate(event) === reportDate) assigned.push(event);
  }
  for (const event of timeline.exitOnly) {
    if (localDate(event) === reportDate) assigned.push(event);
  }

  const ins = assigned
    .filter((event) => event.direction === 'IN')
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const outs = assigned
    .filter((event) => event.direction === 'OUT')
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const firstIn = ins[0] ?? null;
  const lastOut = outs[outs.length - 1] ?? null;
  const assignedPairs = timeline.completed.filter((pair) => localDate(pair.inEvent) === reportDate);
  const visits = assignedPairs.length;
  const netMinutes = assignedPairs.reduce((total, pair) => total + pairMinutes(pair), 0);

  let status: AttendanceStatus;
  let spanHours: number | null = null;
  if (firstIn && lastOut) {
    status = 'PRESENT';
    spanHours = roundHours(
      Math.max(0, lastOut.occurredAt.getTime() - firstIn.occurredAt.getTime()) / 3_600_000,
    );
  } else if (firstIn) {
    status = 'ON_SITE';
  } else if (lastOut) {
    status = 'MISSING_IN';
  } else {
    status = 'ABSENT';
    spanHours = 0;
  }

  const amended = assigned.some((event) => event.source !== 'gate');
  const overnight = assignedPairs.some((pair) => localDate(pair.outEvent) > reportDate);

  let duplicateSuspect = false;
  if (amended) {
    for (const group of [ins, outs]) {
      for (let index = 1; index < group.length; index += 1) {
        const previous = group[index - 1]!;
        const current = group[index]!;
        if (Math.abs(current.occurredAt.getTime() - previous.occurredAt.getTime()) <= 120_000) {
          duplicateSuspect = true;
        }
      }
    }
  }

  const flags: AttendanceFlag[] = [];
  if (overnight) flags.push('OVERNIGHT');
  if (status === 'ON_SITE' && reportDate < today) flags.push('NO_EXIT');
  if (amended) flags.push('AMENDED');
  if (duplicateSuspect) flags.push('DUPLICATE_SUSPECT');

  return {
    date: reportDate,
    status,
    firstIn: firstIn?.occurredAt ?? null,
    lastOut: lastOut?.occurredAt ?? null,
    spanHours,
    netHours: roundHours(netMinutes / 60),
    visits,
    flags,
    amended,
    firstInEventId: firstIn?.id ?? null,
    lastOutEventId: lastOut?.id ?? null,
  };
}

export function deriveDateRange(
  events: DerivationEvent[],
  from: string,
  to: string,
  today = currentLocalDate(),
): AttendanceDerivation[] {
  const start = DateTime.fromISO(from, { zone: APP_ZONE }).startOf('day');
  const end = DateTime.fromISO(to, { zone: APP_ZONE }).startOf('day');
  if (!start.isValid || !end.isValid || end < start) return [];
  const days: AttendanceDerivation[] = [];
  let cursor = start;
  while (cursor <= end) {
    const date = cursor.toISODate() ?? '';
    days.push(deriveAttendanceDay(events, date, today));
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

export function localDayWindow(date: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(date, { zone: APP_ZONE }).startOf('day').toUTC().toJSDate();
  const end = DateTime.fromISO(date, { zone: APP_ZONE }).plus({ days: 1 }).startOf('day').toUTC().toJSDate();
  return { start, end };
}

export function eventLocalDate(event: { occurredAt: Date }): string {
  return DateTime.fromJSDate(event.occurredAt, { zone: 'utc' }).setZone(APP_ZONE).toISODate() ?? '';
}
