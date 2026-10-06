import { sendBirthdayReminders } from '@/lib/utils/birthdayReminders';
import { sendBirthdayNudgeEmails } from '@/lib/utils/birthdayNudgeEmails';

/**
 * The one daily birthday cron (`GET /api/cron/birthdays`, WIS-345): every
 * job about profile birthdays runs here, one after the other, so they share a
 * single Vercel Cron entry and its 60s (`maxDuration`).
 *
 * Each task gets its own time budget, its share of the 60s, as a deadline it
 * checks before starting new work, and its own caps; what a budget or a cap
 * leaves is sent by the next run, within the task's catch-up window. Budgets
 * add up to well under the 60s, leaving room for the last piece of work a
 * task started before its deadline. A task that throws is reported and the
 * next one still runs.
 *
 * To add a task: give it a name, a budget (and lower the others' so the sum
 * stays under `BIRTHDAY_CRON_TOTAL_BUDGET_MS`), and a `run` that honours the
 * deadline and is safe to re-run.
 */

/** What the tasks' budgets may add up to, inside the route's 60s. */
export const BIRTHDAY_CRON_TOTAL_BUDGET_MS = 45_000;

export type BirthdayTaskResult = Record<string, number | boolean>;

export interface BirthdayTask {
  /** Its key in the cron's answer. */
  name: string;
  /** How long it may keep starting new work. */
  budgetMs: number;
  run(now: Date, deadline: number): Promise<BirthdayTaskResult>;
}

export const BIRTHDAY_TASKS: readonly BirthdayTask[] = [
  {
    // Friends' birthday reminders, a week ahead (lib/utils/birthdayReminders.ts).
    name: 'reminders',
    budgetMs: 25_000,
    run: async (now, deadline) => ({ ...(await sendBirthdayReminders(now, { deadline })) }),
  },
  {
    // The nudge email before your own birthday (lib/utils/birthdayNudgeEmails.ts, WIS-344).
    name: 'nudges',
    budgetMs: 15_000,
    run: async (now, deadline) => ({
      ...(await sendBirthdayNudgeEmails(now, undefined, deadline)),
    }),
  },
];

export interface BirthdayCronRun {
  /** Every task ran without throwing. */
  ok: boolean;
  /** Each task's counts, or `{ failed: true }`. */
  results: Record<string, BirthdayTaskResult>;
}

/** Run each task in turn, each against its own deadline (see the top of this file). */
export async function runBirthdayTasks(
  now: Date = new Date(),
  tasks: readonly BirthdayTask[] = BIRTHDAY_TASKS
): Promise<BirthdayCronRun> {
  const run: BirthdayCronRun = { ok: true, results: {} };
  for (const task of tasks) {
    try {
      run.results[task.name] = await task.run(now, Date.now() + task.budgetMs);
    } catch (err) {
      run.ok = false;
      run.results[task.name] = { failed: true };
      // By its kind only: no personal data in logs.
      console.error(
        `Birthday task ${task.name} failed (${err instanceof Error ? err.name : 'unknown error'})`
      );
    }
  }
  return run;
}
