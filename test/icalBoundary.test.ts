// ical.js stays behind the CalendarProvider (docs/adr/0003): only
// provider.ts may import it, and what the provider exports is Hearth's own
// shapes. Checked statically over the source tree, like clientBundle.test.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ParsedEvent } from '../src/features/calendar/types.js';
import * as provider from '../src/features/calendar/provider.js';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the ical.js boundary', () => {
  it('is imported by the provider and nothing else under src', () => {
    const importers = sourceFiles(srcRoot)
      .filter((file) => /from\s+['"]ical\.js['"]|import\s*\(\s*['"]ical\.js['"]\s*\)|require\(\s*['"]ical\.js['"]\s*\)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcRoot, file));

    expect(importers).toEqual(['features/calendar/provider.ts']);
  });

  it('exports only parseFeed and NotIcsError as values', () => {
    expect(Object.keys(provider).sort()).toEqual(['NotIcsError', 'parseFeed']);
  });

  it('returns events made of plain values', () => {
    type Timed = Extract<ParsedEvent, { kind: 'timed' }>;
    type AllDay = Extract<ParsedEvent, { kind: 'allDay' }>;
    expectTypeOf<ReturnType<typeof provider.parseFeed>>().toEqualTypeOf<{ events: ParsedEvent[]; skipped: number }>();
    expectTypeOf<ParsedEvent['uid']>().toEqualTypeOf<string>();
    expectTypeOf<ParsedEvent['recurrenceId']>().toEqualTypeOf<string | null>();
    expectTypeOf<ParsedEvent['title']>().toEqualTypeOf<string>();
    expectTypeOf<ParsedEvent['location']>().toEqualTypeOf<string | null>();
    expectTypeOf<[Timed['startAt'], Timed['endAt']]>().toEqualTypeOf<[Date, Date]>();
    expectTypeOf<AllDay['startDate']>().toBeString();
  });
});
