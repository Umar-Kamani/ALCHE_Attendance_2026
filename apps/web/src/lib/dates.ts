import { DateTime } from 'luxon';

export const APP_ZONE = 'Africa/Mauritius';

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  return DateTime.fromISO(value, { zone: 'utc' }).setZone(APP_ZONE).toFormat('HH:mm');
}

export function formatTimeSeconds(value: string | null | undefined): string {
  if (!value) return '—';
  return DateTime.fromISO(value, { zone: 'utc' }).setZone(APP_ZONE).toFormat('HH:mm:ss');
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? DateTime.fromISO(value, { zone: APP_ZONE })
    : DateTime.fromISO(value, { zone: 'utc' }).setZone(APP_ZONE);
  return dt.toFormat('dd LLL yyyy');
}

export function formatDateShort(value: string): string {
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? DateTime.fromISO(value, { zone: APP_ZONE })
    : DateTime.fromISO(value, { zone: 'utc' }).setZone(APP_ZONE);
  return dt.toFormat('dd LLL');
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return DateTime.fromISO(value, { zone: 'utc' })
    .setZone(APP_ZONE)
    .toFormat("dd LLL yyyy, HH:mm:ss");
}

export function formatMonth(value: string): string {
  return DateTime.fromISO(`${value}-01`, { zone: APP_ZONE }).toFormat('LLLL yyyy');
}

export function todayLocal(): string {
  return DateTime.now().setZone(APP_ZONE).toISODate() ?? '';
}

export function currentMonthStart(): string {
  return DateTime.now().setZone(APP_ZONE).startOf('month').toISODate() ?? '';
}

export function currentMonth(): string {
  return DateTime.now().setZone(APP_ZONE).toFormat('yyyy-MM');
}

export function elapsedLabel(isoValue: string, now = DateTime.utc()): string {
  const start = DateTime.fromISO(isoValue, { zone: 'utc' });
  const minutes = Math.max(0, Math.floor(now.diff(start, 'minutes').minutes));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function durationLabel(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

export function hoursLabel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}h`;
}

export function toLocalInputValue(isoValue?: string | null): string {
  const dt = isoValue
    ? DateTime.fromISO(isoValue, { zone: 'utc' }).setZone(APP_ZONE)
    : DateTime.now().setZone(APP_ZONE);
  return dt.toFormat("yyyy-LL-dd'T'HH:mm");
}

export function localInputToIso(value: string): string {
  return DateTime.fromISO(value, { zone: APP_ZONE }).toUTC().toISO() ?? '';
}

export function monthDays(month: string): string[] {
  const start = DateTime.fromISO(`${month}-01`, { zone: APP_ZONE });
  return Array.from({ length: start.daysInMonth ?? 30 }, (_, index) =>
    start.plus({ days: index }).toISODate() as string,
  );
}

export function isOverdue(value: string): boolean {
  return DateTime.fromISO(value, { zone: 'utc' }) < DateTime.utc();
}
