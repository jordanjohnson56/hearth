// The client side of the public chores API (feature.server.ts): the board,
// claims and the wall's undo. No bearer: anyone at the wall may claim.
import { readErrorMessage } from '../../client/admin/session.js';
import { readJson } from '../../client/http.js';
import type { BoardResponse, ClaimInputWire, CompletionWire } from './types.js';

/** GET /api/chores/board. */
export async function fetchBoard(signal: AbortSignal): Promise<BoardResponse> {
  const res = await fetch('/api/chores/board', { signal });
  if (!res.ok) throw new Error(`Could not load the chores (${String(res.status)})`);
  return readJson<BoardResponse>(res);
}

/** POST /api/chores/:id/claims. Throws with the server's message (409 not claimable, say). */
export async function postClaim(choreId: number, personId: number): Promise<CompletionWire> {
  const body: ClaimInputWire = { personId };
  const res = await fetch(`/api/chores/${String(choreId)}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(await readErrorMessage(res));
  return readJson<CompletionWire>(res);
}

/** POST /api/chores/completions/:id/undo. Throws with the server's message (409 after 15 s, say). */
export async function postUndo(completionId: number): Promise<void> {
  const res = await fetch(`/api/chores/completions/${String(completionId)}/undo`, { method: 'POST' });
  if (res.status !== 204) throw new Error(await readErrorMessage(res));
}
