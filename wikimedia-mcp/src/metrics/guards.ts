import { MAX_SPAN, MIN_DATE_MOST_READ, MIN_DATE_PAGEVIEWS } from './constants.js';

/**
 * Phase 3 §4.4 — all metrics date/granularity/range guards are local, run in a
 * fixed order, and produce ZERO outbound requests on failure.
 */
export class DateGuardError extends Error {
  constructor(
    readonly code: 'validation_error' | 'invalid_date_range' | 'invalid_article',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DateGuardError';
  }
}

export type Granularity = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type ParsedDate = { readonly year: number; readonly month: number; readonly day: number; readonly hour: number | null; readonly ts: number };

const DAY_MS = 86_400_000;

/** Strict YYYYMMDD / YYYYMMDDHH parse with a calendar round-trip (no normalisation). */
export function parseCompact(value: string): ParsedDate | null {
  if (!/^\d{8}(?:\d{2})?$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = value.length === 10 ? Number(value.slice(8, 10)) : null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour !== null && hour > 23) return null;
  const ts = Date.UTC(year, month - 1, day, hour ?? 0, 0, 0, 0);
  const date = new Date(ts);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || (hour !== null && date.getUTCHours() !== hour)) {
    return null;
  }
  return { year, month, day, hour, ts };
}

export function startOfUtcDay(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function minTs(yyyymmdd: number): number {
  const value = String(yyyymmdd);
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
}

function shape(value: string, granularity: Granularity, field: 'start' | 'end'): ParsedDate {
  const expectedLength = granularity === 'hourly' ? 10 : 8;
  if (value.length !== expectedLength) {
    throw new DateGuardError(
      'validation_error',
      `'${field}' must be ${expectedLength} digits for granularity '${granularity}'.`,
      { field, granularity, expected_length: expectedLength },
    );
  }
  const parsed = parseCompact(value);
  if (parsed === null) {
    throw new DateGuardError('validation_error', `'${field}' is not a valid calendar date.`, { field, value });
  }
  return parsed;
}

function alignment(parsed: ParsedDate, granularity: Granularity, field: 'start' | 'end'): void {
  if (granularity === 'weekly' && new Date(parsed.ts).getUTCDay() !== 1) {
    throw new DateGuardError('invalid_date_range', `'${field}' must be a Monday for weekly data.`, { field, value: parsed });
  }
  if (granularity === 'monthly' && parsed.day !== 1) {
    throw new DateGuardError('invalid_date_range', `'${field}' must be the 1st of a month for monthly data.`, { field, value: parsed });
  }
}

function bounds(start: ParsedDate, end: ParsedDate, min: number, nowMs: number): void {
  const todayStart = startOfUtcDay(nowMs);
  if (start.ts < minTs(min)) {
    throw new DateGuardError('invalid_date_range', `'start' may not be earlier than ${min}.`, { field: 'start', minimum: min });
  }
  if (start.ts > end.ts) {
    throw new DateGuardError('invalid_date_range', `'start' must not be after 'end'.`, { field: 'start', detail: 'reversed_range' });
  }
  if (end.ts >= todayStart) {
    throw new DateGuardError('invalid_date_range', `'end' must be a completed UTC day (<= yesterday).`, {
      field: 'end', detail: 'future_or_today',
    });
  }
}

function span(start: ParsedDate, end: ParsedDate, granularity: Granularity): void {
  const cap = MAX_SPAN[granularity];
  if (granularity === 'hourly') {
    const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
    const hours = Math.floor((end.ts - start.ts) / 3_600_000) + 1;
    if (!sameDay || hours > cap) {
      throw new DateGuardError('invalid_date_range', `Hourly range must stay within one UTC day and at most ${cap} hours.`, {
        limits: { cap, observed: hours, unit: 'hours' },
      });
    }
    return;
  }
  const startDay = Date.UTC(start.year, start.month - 1, start.day);
  const endDay = Date.UTC(end.year, end.month - 1, end.day);
  const days = Math.round((endDay - startDay) / DAY_MS) + 1;
  if (days > cap) {
    throw new DateGuardError('invalid_date_range', `Range of ${days} days exceeds the ${granularity} cap of ${cap} days.`, {
      limits: { cap, observed: days, unit: 'days' },
    });
  }
}

export function guardCompactRange(
  start: string,
  end: string,
  granularity: Granularity,
  nowMs: number,
  min = MIN_DATE_PAGEVIEWS,
): { start: ParsedDate; end: ParsedDate } {
  const startParsed = shape(start, granularity, 'start');
  const endParsed = shape(end, granularity, 'end');
  alignment(startParsed, granularity, 'start');
  alignment(endParsed, granularity, 'end');
  bounds(startParsed, endParsed, min, nowMs);
  span(startParsed, endParsed, granularity);
  return { start: startParsed, end: endParsed };
}

/** get_most_read date is ISO `YYYY-MM-DD`; 'today'/future are rejected locally. */
export function guardIsoDate(date: string, nowMs: number): { yyyy: string; mm: string; dd: string; yyyymmdd: number } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) === false) {
    throw new DateGuardError('validation_error', `'date' must be an ISO date (YYYY-MM-DD).`, { field: 'date', value: date });
  }
  const yyyymmdd = Number(`${date.slice(0, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`);
  const parsed = parseCompact(String(yyyymmdd));
  if (parsed === null) {
    throw new DateGuardError('validation_error', `'date' is not a valid calendar date.`, { field: 'date', value: date });
  }
  if (yyyymmdd < MIN_DATE_MOST_READ) {
    throw new DateGuardError('invalid_date_range', `'date' must not be earlier than ${MIN_DATE_MOST_READ}.`, { field: 'date', minimum: MIN_DATE_MOST_READ });
  }
  if (parsed.ts >= startOfUtcDay(nowMs)) {
    throw new DateGuardError('invalid_date_range', `'date' must be a completed UTC day (<= yesterday); 'today' and future dates are rejected.`, {
      field: 'date', detail: 'future_or_today',
    });
  }
  return { yyyy: date.slice(0, 4), mm: date.slice(5, 7), dd: date.slice(8, 10), yyyymmdd };
}
