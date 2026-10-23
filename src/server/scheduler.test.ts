import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureJob } from '../features/types.js';
import { captureLogger } from '../../test/helpers/logger.js';
import { startScheduler } from './scheduler.js';

interface CountingJob extends FeatureJob {
  runs: () => number;
}

/** A job whose every run finishes at once. */
function countingJob(name: string, intervalMs: number): CountingJob {
  let runs = 0;
  return {
    name,
    intervalMs,
    run: () => {
      runs += 1;
      return Promise.resolve();
    },
    runs: () => runs,
  };
}

/** A job whose runs finish only when the test says so. */
function slowJob(intervalMs: number): CountingJob & { finishRun: () => void } {
  let runs = 0;
  let finish: () => void = () => undefined;
  return {
    name: 'slow',
    intervalMs,
    run: () => {
      runs += 1;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    runs: () => runs,
    finishRun: () => {
      finish();
    },
  };
}

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs each job once as soon as it starts', () => {
    const job = countingJob('poll', 60_000);
    const scheduler = startScheduler([job], captureLogger().logger);

    expect(job.runs()).toBe(1);
    scheduler.stop();
  });

  it('runs a job again every intervalMs', async () => {
    const job = countingJob('poll', 60_000);
    const scheduler = startScheduler([job], captureLogger().logger);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(job.runs()).toBe(2);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(job.runs()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(job.runs()).toBe(3);

    scheduler.stop();
  });

  it('runs each job on its own interval', async () => {
    const fast = countingJob('fast', 1_000);
    const slow = countingJob('slow', 5_000);
    const scheduler = startScheduler([fast, slow], captureLogger().logger);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(fast.runs()).toBe(6);
    expect(slow.runs()).toBe(2);
    scheduler.stop();
  });

  it('makes a tick a no-op while the previous run is still in progress', async () => {
    const job = slowJob(1_000);
    const scheduler = startScheduler([job], captureLogger().logger);

    await vi.advanceTimersByTimeAsync(3_500);
    expect(job.runs()).toBe(1);

    job.finishRun();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(job.runs()).toBe(2);

    scheduler.stop();
  });

  it('stops running jobs and clears its timers on stop', async () => {
    const job = countingJob('poll', 1_000);
    const scheduler = startScheduler([job], captureLogger().logger);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(job.runs()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs a run that rejects and keeps the job going', async () => {
    const { logger, lines } = captureLogger();
    let runs = 0;
    const job: FeatureJob = {
      name: 'calendar poll',
      intervalMs: 1_000,
      run: () => {
        runs += 1;
        return runs === 1
          ? Promise.reject(new Error('feed failed: https://cal.example/private-0123abcd/basic.ics'))
          : Promise.resolve();
      },
    };
    const scheduler = startScheduler([job], logger);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(runs).toBe(3);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      level: 50,
      job: 'calendar poll',
      err: { message: 'feed failed: https://cal.example/[redacted]' },
    });
    scheduler.stop();
  });

  it('logs a run that throws synchronously and keeps the other jobs going', async () => {
    const { logger, lines } = captureLogger();
    const throwing: FeatureJob = {
      name: 'broken',
      intervalMs: 1_000,
      run: () => {
        throw new Error('not even a promise');
      },
    };
    const other = countingJob('other', 1_000);
    const scheduler = startScheduler([throwing, other], logger);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(other.runs()).toBe(2);
    expect(lines().map((line) => line.job)).toEqual(['broken', 'broken']);
    scheduler.stop();
  });
});
