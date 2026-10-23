// The browser bundle must not carry the Temporal polyfill (ADR 0001 keeps it
// in the pure core; the client does its date math on Intl parts). Checked
// statically: every module reachable from the client entry by relative
// import is read, and none may import the polyfill. A build-and-grep would
// say the same but costs seconds per run.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

// A value import or re-export (`import x from`, `export { x } from`,
// `import 'side-effect'`). Type-only forms are left out on purpose: under
// verbatimModuleSyntax the compiler erases them, so they reach no bundle.
const VALUE_IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)[^'";]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

/** The specifiers one module imports as values, comments stripped first. */
function specifiersOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(VALUE_IMPORT)].map((m) => m[1] ?? m[2] ?? '');
}

/**
 * The file a relative specifier names, trying the `.js` → `.ts`/`.tsx`
 * rewrite the tsconfig paths rely on. Throws when nothing matches, so a
 * broken import is a failed test, not a silently pruned branch.
 */
function resolveRelative(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const candidates = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`cannot resolve ${specifier} from ${from}`);
  return found;
}

/**
 * Every package specifier imported by `entry` or any module it reaches
 * through relative imports. Stylesheets are not followed.
 */
function packagesReachableFrom(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        if (!/\.css$/.test(specifier)) queue.push(resolveRelative(file, specifier));
      } else {
        packages.add(specifier);
      }
    }
  }
  return packages;
}

describe('the client bundle', () => {
  it('does not reach the Temporal polyfill from the client entry', () => {
    const packages = packagesReachableFrom(resolve(srcRoot, 'client/main.tsx'));

    // The walk reached real modules, not an empty set.
    expect([...packages]).toContain('react-dom/client');
    expect([...packages]).not.toContain('temporal-polyfill');
  });

  it('(control) finds the polyfill where the pure core does import it', () => {
    expect([...packagesReachableFrom(resolve(srcRoot, 'core/time.ts'))]).toContain('temporal-polyfill');
  });
});
