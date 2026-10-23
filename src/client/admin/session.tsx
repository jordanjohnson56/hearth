// The admin session: the unlock token and the calls that use it. The token
// lives in React state only (never storage), so a reload locks the kiosk,
// and the provider sits above the router so navigating keeps it.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { readJson } from '../http.js';

export type UnlockResult = { ok: true } | { ok: false; message: string };

export interface AdminSession {
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

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);

  const unlock = useCallback(async (pin: string): Promise<UnlockResult> => {
    const res = await fetch('/api/admin/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) return { ok: false, message: await readErrorMessage(res) };
    const body = await readJson<{ token: string }>(res);
    setToken(body.token);
    return { ok: true };
  }, []);

  const authFetch = useCallback(
    async (input: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (token !== null) headers.set('Authorization', `Bearer ${token}`);
      const res = await fetch(input, { ...init, headers });
      if (res.status === 401) setToken(null);
      return res;
    },
    [token],
  );

  const lock = useCallback(async (): Promise<void> => {
    try {
      await authFetch('/api/admin/lock', { method: 'POST' });
    } finally {
      // Locked locally whatever the server said: the token is only held here.
      setToken(null);
    }
  }, [authFetch]);

  const session = useMemo<AdminSession>(
    () => ({ token, unlock, lock, authFetch }),
    [token, unlock, lock, authFetch],
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
