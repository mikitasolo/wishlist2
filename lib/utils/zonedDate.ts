/**
 * Calendar days in a named time zone (an IANA zone such as `Europe/Berlin`),
 * for the server to work out someone's local midnight without a date
 * library (WIS-342). Pure; `Intl` does the zone rules, daylight saving
 * included.
 */

/** Whether `value` is a time zone this runtime knows. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock parts of `at` in `timeZone`. */
function partsIn(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** The calendar date (`YYYY-MM-DD`) it is at `at` in `timeZone`. */
export function dateInZone(at: Date, timeZone: string): string {
  const { year, month, day } = partsIn(at, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** How far `timeZone`'s wall clock is ahead of UTC at `at`, in ms. */
function offsetAt(at: Date, timeZone: string): number {
  const p = partsIn(at, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The moment `date` (`YYYY-MM-DD`) begins in `timeZone`: its local midnight,
 * or, where a clock change skips midnight, the first moment of the day.
 * Null for a malformed date.
 */
export function startOfDayInZone(date: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const wallMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Guess with the offset at UTC midnight, then once more with the offset at
  // the guess: that settles it unless the day starts inside a clock change.
  let guess = wallMidnight - offsetAt(new Date(wallMidnight), timeZone);
  guess = wallMidnight - offsetAt(new Date(guess), timeZone);
  // A skipped midnight lands on the day before: step to the day's first moment.
  if (dateInZone(new Date(guess), timeZone) < date) {
    guess += 60 * 60 * 1000;
  }
  return new Date(guess);
}
