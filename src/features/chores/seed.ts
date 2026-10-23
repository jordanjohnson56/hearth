// The demo chores for `npm run seed`: fictional household chores covering
// every rule kind (docs/adr/0005), with no completions, so a stranger's
// demo shows a populated pool and an all-zero leaderboard. Start dates are
// counted from the seed day, so the first demo has one chore overdue, one
// due today and a few coming up. Seeding is idempotent: a chore whose name
// is already taken, ignoring case, is left exactly as it is.
import type { Database } from 'better-sqlite3';
import { addDays, localDate } from '../../core/time.js';
import { insertChore, listChores } from './choreRepository.js';
import type { Chore } from './choreRepository.js';
import type { RecurrenceRule } from './rule.js';

interface DemoChore {
  name: string;
  rule: RecurrenceRule;
  points: number;
  /** The start date, in days from the seed day. */
  startsIn: number;
}

export const DEMO_CHORES: readonly DemoChore[] = [
  { name: 'Feed the dog', rule: { kind: 'daily' }, points: 2, startsIn: -2 },
  { name: 'Empty the dishwasher', rule: { kind: 'daily' }, points: 3, startsIn: 0 },
  { name: 'Take out the bins', rule: { kind: 'weekly', days: ['mon', 'thu'] }, points: 3, startsIn: -1 },
  { name: 'Vacuum the hall', rule: { kind: 'weekly', days: ['wed', 'sat'] }, points: 5, startsIn: 0 },
  { name: 'Water the plants', rule: { kind: 'every', unit: 'days', interval: 3 }, points: 2, startsIn: 1 },
  { name: 'Clean the bathroom', rule: { kind: 'every', unit: 'weeks', interval: 2 }, points: 8, startsIn: 3 },
  { name: 'Change the sheets', rule: { kind: 'monthly', day: 1 }, points: 6, startsIn: 0 },
  { name: 'Wash the car', rule: { kind: 'whenever' }, points: 10, startsIn: 0 },
  { name: 'Sort the recycling', rule: { kind: 'whenever' }, points: 2, startsIn: 0 },
];

/**
 * Adds each demo chore whose name is free, in one transaction, with start
 * dates counted from the local date of `now` in `zone`. Returns the demo
 * chores as they stand afterwards.
 */
export function seedChores(db: Database, now: Date, zone: string): Chore[] {
  const today = localDate(now, zone);
  db.transaction(() => {
    const taken = new Set(listChores(db).map((chore) => chore.name.toLowerCase()));
    for (const demo of DEMO_CHORES) {
      if (taken.has(demo.name.toLowerCase())) continue;
      insertChore(
        db,
        { name: demo.name, rule: demo.rule, points: demo.points, startDate: addDays(today, demo.startsIn) },
        now,
      );
    }
  })();
  const demoNames = new Set(DEMO_CHORES.map((demo) => demo.name.toLowerCase()));
  return listChores(db).filter((chore) => demoNames.has(chore.name.toLowerCase()));
}
