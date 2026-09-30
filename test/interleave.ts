import { vi } from 'vitest';

/**
 * Runs a race in one fixed order, which a bare `Promise.all` would only hit by
 * luck. The first call to `model[method]` is held while `meanwhile` runs to
 * completion and then goes through, so whatever `meanwhile` does lands just
 * before it. With `after`, the held call goes through first and returns only once
 * `meanwhile` is done, so it lands just after. Every later call, including the
 * ones `meanwhile` makes, goes straight through.
 *
 * Hold only a call the code under test awaits as is: the held call returns a
 * plain promise, so chaining `.select()` or `.lean()` onto it would break. The spy
 * stays until `restore()` or `vi.restoreAllMocks()`.
 */
export function holdFirstCall<T>(
  model: object,
  method: string,
  meanwhile: () => Promise<T>,
  { after = false }: { after?: boolean } = {}
) {
  const target = model as Record<string, (...args: unknown[]) => unknown>;
  const real = target[method].bind(model);
  let held = false;
  let outcome: T | undefined;
  const runMeanwhile = async () => {
    outcome = await meanwhile();
  };
  const spy = vi.spyOn(target, method).mockImplementation((...args: unknown[]) => {
    if (held) return real(...args);
    held = true;
    return after
      ? Promise.resolve(real(...args)).then(async (result) => {
          await runMeanwhile();
          return result;
        })
      : runMeanwhile().then(() => real(...args));
  });
  return {
    /** Whether the call was reached at all, so the race really ran. */
    held: () => held,
    /** What `meanwhile` resolved to, once the held call has returned. */
    outcome: () => outcome,
    restore: () => spy.mockRestore(),
  };
}
