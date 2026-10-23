import { defineConfig } from 'vitest/config';

// Force UTC for the test run, whatever the host zone. Set on the parent
// process before any worker starts, so every worker inherits it, and again
// via `env` for good measure. Code under test must take its zone as a
// parameter; this makes accidental reliance on process-local time visible
// identically on a UTC CI runner and a Chicago laptop.
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.ts',
        'src/client/**',
        'src/**/*.client.{ts,tsx}',
        'src/server/main.ts',
        'src/server/seed.ts',
      ],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
