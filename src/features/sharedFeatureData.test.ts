import { describe, expect, it } from 'vitest';
import { sharedFeatureData } from './sharedFeatureData.js';
import type { FeatureId } from './types.js';

/** A fake server: records each request and lets the test answer it. */
function fakeBoard() {
  const requests: { signal: AbortSignal; answer: (body: string) => void }[] = [];
  const fetcher = (signal: AbortSignal) =>
    new Promise<string>((resolve) => {
      requests.push({ signal, answer: resolve });
    });
  return { requests, fetcher };
}

/** A fake change-hint stream: what liveUpdates would run on a `chores` hint. */
function fakeHints() {
  const registered = new Set<() => void>();
  const register = (_feature: FeatureId, refetch: () => void) => {
    registered.add(refetch);
    return () => {
      registered.delete(refetch);
    };
  };
  const hint = () => {
    for (const refetch of registered) refetch();
  };
  return { registered, register, hint };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sharedFeatureData', () => {
  it('sends one request for two consumers and gives both the same snapshot', async () => {
    const server = fakeBoard();
    const shared = sharedFeatureData('chores', server.fetcher, fakeHints().register);
    let notified = 0;
    shared.subscribe(() => (notified += 1));

    shared.connect('2026-10-23');
    shared.connect('2026-10-23');
    server.requests[0]?.answer('board 1');
    await settle();

    expect(server.requests).toHaveLength(1);
    expect(shared.getSnapshot().data).toBe('board 1');
    expect(notified).toBeGreaterThan(0);
  });

  it('sends one request per hint however many consumers are mounted', async () => {
    const server = fakeBoard();
    const hints = fakeHints();
    const shared = sharedFeatureData('chores', server.fetcher, hints.register);
    shared.connect('2026-10-23');
    shared.connect('2026-10-23');

    hints.hint();
    server.requests[1]?.answer('board 2');
    await settle();

    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]?.signal.aborted).toBe(true);
    expect(shared.getSnapshot().data).toBe('board 2');
  });

  it('sends one request when the local date turns, whichever consumer sees it first', () => {
    const server = fakeBoard();
    const shared = sharedFeatureData('chores', server.fetcher, fakeHints().register);
    const tile = shared.connect('2026-10-23');
    const page = shared.connect('2026-10-23');

    // Each consumer reconnects with the new date as its clock ticks past midnight.
    tile();
    shared.connect('2026-10-24');
    page();
    shared.connect('2026-10-24');

    expect(server.requests).toHaveLength(2);
  });

  it('stops listening for hints and drops the request in flight when the last consumer leaves', () => {
    const server = fakeBoard();
    const hints = fakeHints();
    const shared = sharedFeatureData('chores', server.fetcher, hints.register);
    const tile = shared.connect('2026-10-23');
    const page = shared.connect('2026-10-23');

    tile();
    page();
    hints.hint();

    expect(hints.registered.size).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.signal.aborted).toBe(true);
  });
});
