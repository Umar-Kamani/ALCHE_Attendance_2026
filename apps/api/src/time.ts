import { DateTime, Duration } from 'luxon';
import { config } from './config.js';

export const APP_ZONE = 'Indian/Mauritius';

export function nowUtc(): DateTime {
  return DateTime.utc();
}

export function localDateOf(value: Date | string | DateTime): string {
  const dt =
    value instanceof DateTime
      ? value.setZone(APP_ZONE)
      : DateTime.fromJSDate(value instanceof Date ? value : new Date(value), { zone: 'utc' }).setZone(
          APP_ZONE,
        );
  return dt.toISODate() ?? '';
}

export function localTimeOf(value: Date | string | DateTime): string {
  const dt =
    value instanceof DateTime
      ? value.setZone(APP_ZONE)
      : DateTime.fromJSDate(value instanceof Date ? value : new Date(value), { zone: 'utc' }).setZone(
          APP_ZONE,
        );
  return dt.toFormat('HH:mm:ss');
}

export function localDateStart(date: string): DateTime {
  return DateTime.fromISO(date, { zone: APP_ZONE }).startOf('day');
}

export function localDateEndExclusive(date: string): DateTime {
  return localDateStart(date).plus({ days: 1 });
}

export function rangeStartUtc(from: string): Date {
  return localDateStart(from).toUTC().toJSDate();
}

export function rangeEndUtc(to: string): Date {
  return localDateEndExclusive(to).toUTC().toJSDate();
}

export function iso(value: Date | null | undefined): string | null {
  return value ? DateTime.fromJSDate(value, { zone: 'utc' }).toISO() : null;
}

export function isoRequired(value: Date): string {
  return DateTime.fromJSDate(value, { zone: 'utc' }).toISO() ?? new Date(0).toISOString();
}

export function parseLocalDateTime(value: string): DateTime {
  return DateTime.fromISO(value, { setZone: true });
}

export function currentLocalDate(): string {
  return nowUtc().setZone(APP_ZONE).toISODate() ?? '';
}

export function currentLocalMonthRange(): { from: string; to: string } {
  const today = nowUtc().setZone(APP_ZONE);
  return {
    from: today.startOf('month').toISODate() ?? '',
    to: today.toISODate() ?? '',
  };
}

export function hoursBetween(from: Date, to: Date): number {
  return Duration.fromMillis(to.getTime() - from.getTime()).as('hours');
}

export function formatHours(value: number | null): string {
  return value === null ? '' : value.toFixed(2);
}

export function isDefaultAdminWarning(): boolean {
  return config.adminPasswordIsDefault;
}
