import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The text of test/fixtures/ical/<name>.txt. The fixtures are hand-written
 * iCalendar feeds about the fictional family (Ada, Linus, Marie, Grace);
 * that directory is the one place the privacy rails allow an iCalendar
 * payload, so a feed never sits in a .ts file.
 */
export function icalFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/ical/${name}.txt`, import.meta.url)), 'utf8');
}
