// A weekday clock: elapsed and remaining time measured only on Monday through
// Friday, in the host's local time zone. The weekend passes in an instant, so
// a quota that pauses over a weekend is not read as having surplus headroom.
// Pure calendar arithmetic, so it is testable anywhere.

const DAY = 86_400_000;

/** The latest timestamp JavaScript's Date can represent. */
const MAX_DATE_MS = 8_640_000_000_000_000;

/**
 * A conservative ceiling on conversions from weekday time to wall-clock time.
 * The published projection is only useful within a cycle or two, and this
 * keeps a pathological burn rate from walking the calendar for aeons.
 */
const MAX_ACTIVE_MS = 100 * 365 * DAY;

/** Monday through Friday in the host's local time. */
export function isWeekday(ms: number): boolean {
  const day = new Date(ms).getDay();
  return day !== 0 && day !== 6;
}

/** The first instant of the next local day, which handles DST transitions. */
function nextLocalMidnight(ms: number): number {
  const date = new Date(ms);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

/**
 * Milliseconds in `[fromMs, toMs)` that fall on a weekday in the host's local
 * time. A reversed or non-finite range counts as zero.
 */
export function weekdayMsBetween(fromMs: number, toMs: number): number {
  let total = 0;
  let cursor = fromMs;
  while (Number.isFinite(cursor) && cursor < toMs) {
    const next = Math.min(nextLocalMidnight(cursor), toMs);
    if (isWeekday(cursor)) total += next - cursor;
    cursor = next;
  }
  return total;
}

/**
 * The wall-clock instant reached after spending `activeMs` of weekday time
 * from `fromMs`. Weekends pass without consuming the budget, so a Friday
 * evening projection lands on the following working day rather than two
 * calendar days earlier. Returns `undefined` when the result is not a
 * representable timestamp or lies beyond the useful horizon.
 */
export function addWeekdayMs(
  fromMs: number,
  activeMs: number,
): number | undefined {
  if (!Number.isFinite(fromMs) || !Number.isFinite(activeMs)) return undefined;
  if (activeMs < 0 || activeMs > MAX_ACTIVE_MS) return undefined;
  let remaining = activeMs;
  let cursor = fromMs;
  if (!Number.isFinite(cursor) || Math.abs(cursor) > MAX_DATE_MS)
    return undefined;
  // Whole weeks always hold five weekdays, so skip seven days at a time and
  // walk only the last partial week day by day.
  for (;;) {
    const weekEnd = cursor + 7 * DAY;
    if (!Number.isFinite(weekEnd) || Math.abs(weekEnd) > MAX_DATE_MS)
      return undefined;
    const weekActive = weekdayMsBetween(cursor, weekEnd);
    if (weekActive <= 0 || remaining <= weekActive) break;
    remaining -= weekActive;
    cursor = weekEnd;
  }
  while (remaining > 0) {
    const next = nextLocalMidnight(cursor);
    if (!Number.isFinite(next) || next <= cursor) return undefined;
    if (!isWeekday(cursor)) {
      cursor = next;
      continue;
    }
    const length = next - cursor;
    if (remaining < length) {
      cursor += remaining;
      break;
    }
    remaining -= length;
    cursor = next;
  }
  return Number.isFinite(cursor) && Math.abs(cursor) <= MAX_DATE_MS
    ? cursor
    : undefined;
}
