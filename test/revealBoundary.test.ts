// SecretUrl.reveal() is the one way an address becomes a string again. Its
// callers are the fetcher (the outbound request) and the source repository
// (the two writes to calendar_source_secret), and nothing else under src:
// checked statically, like test/icalBoundary.test.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    // Production modules only: secretUrl.test.ts exercises reveal() itself.
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the SecretUrl.reveal() boundary', () => {
  it('is called by the fetcher and the source repository and nothing else under src', () => {
    const callers = sourceFiles(srcRoot)
      .filter((file) => /\.reveal\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcRoot, file))
      .sort();

    expect(callers).toEqual(['features/calendar/fetcher.ts', 'features/calendar/sourceRepository.ts']);
  });
});
