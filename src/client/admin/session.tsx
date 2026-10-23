// The admin session: whether a PIN is set, the unlock token and the calls
// that use it. The token lives in React state only (never storage), so a
// reload locks the kiosk, and the provider sits above the router so
// navigating keeps it. The client locks itself on the server's lifetimes
// (src/core/adminSession.ts), so a walked-away tablet relocks on time
// rather than at its next refused call.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TOKEN_IDLE_MS, TOKEN_MAX_MS } from '../../core/adminSession.js';
import { readJson } from '../http.js';

export type UnlockResult = { ok: true } | { ok: false; message: string };

/** What GET /api/admin/status said, or why it could not be asked. */
export type PinStatus = { kind: 'loading' } | { kind: 'unreachable' } | { kind: 'ready'; pinSet: boolean };

export interface AdminSession {
  /** Fetched at load; the header's "Set a PIN" and the admin page read it. */
  pinStatus: PinStatus;
  /** Asks the server again (the admin page's "Try again"). */
  refreshPinStatus: () => void;
  /** Notes that the first PIN was just set, without a round trip. */
  markPinSet: () => void;
  /** The live bearer token, or null while locked. */
  token: string | null;
  /** Tries `pin`; a refusal carries the server's message ("Wrong PIN", "Try again in N s"). */
  unlock(pin: string): Promise<UnlockResult>;
  /** Revokes the token on the server and forgets it here. */
  lock(): Promise<void>;
  /**
   * fetch with the bearer header. A 401 means the session is gone (expired
   * or the server restarted): the token is dropped and the page relocks.
   */
  authFetch(input: string, init?: RequestInit): Promise<Response>;
}

const AdminSessionContext = createContext<AdminSession | null>(null);

/** When the token dies on its own: `idle` moves with every authenticated call, `max` is fixed at unlock. */
interface Deadlines {
  idle: number;
  max: number;
}

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [pinStatus, setPinStatus] = useState<PinStatus>({ kind: 'loading' });
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const deadlines = useRef<Deadlines | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/status')
      .then(async (res) => {
        if (!res.ok) throw new Error('status failed');
        return readJson<{ pinSet: boolean }>(res);
      })
      .then(
        (body) => {
          if (!cancelled) setPinStatus({ kind: 'ready', pinSet: body.pinSet });
        },
        () => {
          if (!cancelled) setPinStatus({ kind: 'unreachable' });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [statusAttempt]);

  const refreshPinStatus = useCallback(() => {
    setPinStatus({ kind: 'loading' });
    setStatusAttempt((n) => n + 1);
  }, []);

  const markPinSet = useCallback(() => {
    setPinStatus({ kind: 'ready', pinSet: true });
  }, []);

  const unlock = useCallback(async (pin: string): Promise<UnlockResult> => {
    const res = await fetch('/api/admin/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) return { ok: false, message: await readErrorMessage(res) };
    const body = await readJson<{ token: string }>(res);
    const now = Date.now();
    deadlines.current = { idle: now + TOKEN_IDLE_MS, max: now + TOKEN_MAX_MS };
    setToken(body.token);
    return { ok: true };
  }, []);

  const authFetch = useCallback(
    async (input: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (token !== null) headers.set('Authorization', `Bearer ${token}`);
      const res = await fetch(input, { ...init, headers });
      if (res.status === 401) setToken(null);
      else if (deadlines.current !== null) deadlines.current.idle = Date.now() + TOKEN_IDLE_MS;
      return res;
    },
    [token],
  );

  const lock = useCallback(async (): Promise<void> => {
    try {
      await authFetch('/api/admin/lock', { method: 'POST' });
    } finally {
      // Locked locally whatever the server said: the token is only held here.
      deadlines.current = null;
      setToken(null);
    }
  }, [authFetch]);

  // The idle lock. A timer sleeps until the nearer deadline and then looks
  // again, since an authenticated call may have moved the idle one
  // meanwhile. A sleeping tablet fires no timers: on becoming visible the
  // deadlines are checked at once, and a passed one locks.
  useEffect(() => {
    if (token === null) return;
    let timer: number | undefined;
    const check = (): void => {
      window.clearTimeout(timer);
      const due = deadlines.current;
      if (due === null) return;
      const wait = Math.min(due.idle, due.max) - Date.now();
      if (wait <= 0) {
        lock().catch(() => undefined);
        return;
      }
      timer = window.setTimeout(check, wait);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') check();
    };
    check();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token, lock]);

  const session = useMemo<AdminSession>(
    () => ({ pinStatus, refreshPinStatus, markPinSet, token, unlock, lock, authFetch }),
    [pinStatus, refreshPinStatus, markPinSet, token, unlock, lock, authFetch],
  );

  return <AdminSessionContext.Provider value={session}>{children}</AdminSessionContext.Provider>;
}

/** The admin session; feature admin panels call bearer routes through it. */
export function useAdminSession(): AdminSession {
  const session = useContext(AdminSessionContext);
  if (session === null) throw new Error('useAdminSession needs an AdminSessionProvider above it');
  return session;
}

/**
 * The message of a refused request: the boundary's `message` for a 4xx that
 * carries one, else a generic line (a bare 401, a 5xx, a non-JSON body).
 */
export async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await readJson<{ message?: unknown }>(res);
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Not JSON: fall through to the generic line.
  }
  return res.status === 401 ? 'Admin is locked' : `Request failed (${res.status})`;
}
