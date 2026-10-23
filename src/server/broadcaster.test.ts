import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.js';
import { createBroadcaster } from './broadcaster.js';
import type { FeatureId } from '../features/types.js';

describe('createBroadcaster', () => {
  it('delivers a hint to every subscriber even when one of them throws', () => {
    const broadcaster = createBroadcaster(captureLogger().logger);
    const before: FeatureId[] = [];
    const after: FeatureId[] = [];
    broadcaster.subscribe((feature) => before.push(feature));
    broadcaster.subscribe(() => {
      throw new Error('write after end');
    });
    broadcaster.subscribe((feature) => after.push(feature));

    expect(() => {
      broadcaster.publish('chores');
    }).not.toThrow();
    expect(before).toEqual(['chores']);
    expect(after).toEqual(['chores']);
  });

  it('drops a subscriber that threw, so later hints skip it', () => {
    const broadcaster = createBroadcaster(captureLogger().logger);
    let calls = 0;
    broadcaster.subscribe(() => {
      calls += 1;
      throw new Error('socket destroyed');
    });

    broadcaster.publish('calendar');
    broadcaster.publish('calendar');

    expect(calls).toBe(1);
    expect(broadcaster.subscriberCount).toBe(0);
  });

  it('logs the dropped subscriber at warn without any URL', () => {
    const { logger, lines, text } = captureLogger();
    const broadcaster = createBroadcaster(logger);
    broadcaster.subscribe(() => {
      throw new Error('failed writing to https://calendar.example/private/secret-token/basic.ics');
    });

    broadcaster.publish('calendar');

    expect(lines()).toEqual([
      expect.objectContaining({ level: 40, feature: 'calendar', msg: 'dropped a live-update subscriber' }),
    ]);
    expect(text()).not.toContain('secret-token');
  });
});
