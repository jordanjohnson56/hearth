// Runs each feature's job: once right away, then every intervalMs. The
// entrypoint starts it after the server is listening and stops it at
// shutdown. A run never throws past here: failures are logged and the
// next tick happens as scheduled.
import type { FeatureJob } from '../features/types.js';
import type { Logger } from './logger.js';

export interface Scheduler {
  /** Clears every timer. A run already in progress finishes on its own. */
  stop(): void;
}

export function startScheduler(jobs: readonly FeatureJob[], logger: Logger): Scheduler {
  const timers = jobs.map((job) => {
    let running = false;
    // Overlap guard: a tick during a run (a slow feed, say) is a no-op
    // rather than a second concurrent run of the same job.
    const tick = (): void => {
      if (running) return;
      running = true;
      void runGuarded(job, logger).finally(() => {
        running = false;
      });
    };
    tick();
    return setInterval(tick, job.intervalMs);
  });
  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
    },
  };
}

async function runGuarded(job: FeatureJob, logger: Logger): Promise<void> {
  try {
    await job.run();
  } catch (err) {
    // The err serializer cuts any URL in the message down to its host.
    logger.error({ err, job: job.name }, 'job failed');
  }
}
