import { getCronHeartbeatUrl, type CronJob } from '@/lib/env';
import { errorKind } from '@/lib/utils/errorKind';

/**
 * How long a heartbeat may take before it's given up: short, so a slow
 * healthchecks.io never holds a cron near its `maxDuration`.
 */
export const HEARTBEAT_TIMEOUT_MS = 3_000;

/** A run's counts, as a cron answers them: numbers and flags, nested at most a few levels. */
export type HeartbeatCounts = object;

const MAX_DEPTH = 3;

/**
 * Only the numbers and booleans in `value` (nested objects kept as objects of
 * the same), so a ping's body can only ever carry counts: a string, an id, an
 * array or a date anywhere in a run's result is dropped, whatever a job adds
 * to its result later.
 */
export function countsOnly(value: HeartbeatCounts, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') {
      out[key] = v;
    } else if (
      depth < MAX_DEPTH &&
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      const nested = countsOnly(v, depth + 1);
      if (Object.keys(nested).length > 0) out[key] = nested;
    }
  }
  return out;
}

/**
 * Tell the cron's healthchecks.io check (WIS-382) that a run succeeded, so a
 * run that never comes, or never succeeds, raises the check's alert. Call it
 * only after a successful run. A no-op when the cron's
 * `HEALTHCHECK_URL_<NAME>` is unset. The body is the run's counts only
 * (`countsOnly`), shown in the check's log.
 *
 * Never throws and never takes longer than `HEARTBEAT_TIMEOUT_MS`: a failed or
 * slow ping is logged, by the cron's name and the error's kind, never the URL
 * (a credential for the check), and the cron answers as it would have.
 */
export async function pingCronHeartbeat(
  cron: CronJob,
  counts: HeartbeatCounts = {}
): Promise<void> {
  const url = getCronHeartbeatUrl(cron);
  if (!url) return;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(countsOnly(counts)),
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'error',
    });
    // Nothing to read in healthchecks.io's "OK"; free the connection.
    await response.body?.cancel().catch(() => {});
    if (!response.ok) {
      console.error(`Cron heartbeat for ${cron} was refused (HTTP ${response.status})`);
    }
  } catch (err) {
    console.error(`Cron heartbeat for ${cron} failed:`, errorKind(err));
  }
}
