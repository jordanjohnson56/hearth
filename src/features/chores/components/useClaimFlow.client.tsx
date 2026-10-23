import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PersonWire } from '../../../core/person.js';
import { postClaim, postUndo } from '../api.client.js';
import type { BoardChoreWire } from '../types.js';
import { PersonPicker } from './PersonPicker.client.js';
import { UNDO_TOAST_MS, UndoToast } from './UndoToast.client.js';

/** How long the toast stays up to say how an undo went. */
const AFTER_UNDO_MS = 4000;

type Picking = { chore: BoardChoreWire; busy: boolean; error: string | undefined };

type Toast =
  /** A claim just landed: Undo is offered. */
  | { kind: 'claimed'; key: number; completionId: number; message: string; busy: boolean }
  /** The undo was tried: no button, only how it went. */
  | { kind: 'settled'; key: number; message: string };

export interface ClaimFlow {
  /** The first tap: opens the person picker for `chore`. */
  start: (chore: BoardChoreWire) => void;
  /** The picker and the toast; render it anywhere (both leave the tile's box). */
  ui: ReactNode;
}

/**
 * The claim flow the Chores today tile and the Chores page share: tap a
 * chore, tap a person, see a 10-second toast that offers undo. `onChanged`
 * runs after every claim and undo, and after a refused claim (the chore was
 * likely claimed elsewhere); the board itself is never updated
 * optimistically, a refetch is the update.
 */
export function useClaimFlow(people: readonly PersonWire[], onChanged: () => void): ClaimFlow {
  const [picking, setPicking] = useState<Picking | undefined>(undefined);
  const [toast, setToast] = useState<Toast | undefined>(undefined);

  const pick = async (chore: BoardChoreWire, person: PersonWire) => {
    setPicking({ chore, busy: true, error: undefined });
    try {
      const completion = await postClaim(chore.id, person.id);
      setPicking(undefined);
      setToast({
        kind: 'claimed',
        key: completion.id,
        completionId: completion.id,
        message: `${person.displayName} did ${chore.name}, +${String(completion.pointsAwarded)}`,
        busy: false,
      });
    } catch (err) {
      setPicking({ chore, busy: false, error: err instanceof Error ? err.message : 'The claim failed' });
    }
    onChanged();
  };

  const undo = async (completionId: number) => {
    setToast((current) => (current?.kind === 'claimed' ? { ...current, busy: true } : current));
    let message = 'Undone';
    try {
      await postUndo(completionId);
    } catch (err) {
      message = err instanceof Error ? err.message : 'The undo failed';
    }
    setToast({ kind: 'settled', key: -completionId, message });
    onChanged();
  };

  const ui = (
    <>
      {picking !== undefined && (
        <PersonPicker
          choreName={picking.chore.name}
          people={people}
          busy={picking.busy}
          error={picking.error}
          onPick={(person) => void pick(picking.chore, person)}
          onCancel={() => {
            setPicking(undefined);
          }}
        />
      )}
      {toast !== undefined && (
        <UndoToast
          key={toast.key}
          message={toast.message}
          canUndo={toast.kind === 'claimed'}
          busy={toast.kind === 'claimed' && toast.busy}
          durationMs={toast.kind === 'claimed' ? UNDO_TOAST_MS : AFTER_UNDO_MS}
          onUndo={() => {
            if (toast.kind === 'claimed') void undo(toast.completionId);
          }}
          onClose={() => {
            setToast(undefined);
          }}
        />
      )}
    </>
  );

  return {
    start: (chore) => {
      setPicking({ chore, busy: false, error: undefined });
    },
    ui,
  };
}
