import { useEffect, useState } from 'react';

const MINUTE_MS = 60_000;

/**
 * The current instant, refreshed on each wall-clock minute boundary and when
 * the page becomes visible again (a sleeping tablet pauses timers). Each tick
 * re-aims at the next boundary from Date.now(), so drift does not build up.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setNow(new Date());
      clearTimeout(timer);
      timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return now;
}
