import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import '../claim.css';

/** How long the toast offers undo. The server accepts an undo for 15 s, so a late tap still lands. */
export const UNDO_TOAST_MS = 10_000;

export interface UndoToastProps {
  /** What happened, e.g. "Ada did Feed the dog, +2". */
  message: string;
  /** Shows the Undo button; false once an undo was tried (the message then says how it went). */
  canUndo: boolean;
  busy: boolean;
  /** How long the toast stays up; UNDO_TOAST_MS by default. Give the toast a new key to restart it. */
  durationMs?: number;
  onUndo: () => void;
  /** The time is up or the toast was dismissed. */
  onClose: () => void;
}

/**
 * A toast at the bottom of the screen, above the nav, rendered into
 * document.body so no tile clips it. It closes itself after `durationMs`
 * and is announced politely to screen readers.
 */
export function UndoToast({ message, canUndo, busy, durationMs = UNDO_TOAST_MS, onUndo, onClose }: UndoToastProps) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      close.current();
    }, durationMs);
    return () => {
      clearTimeout(timer);
    };
  }, [durationMs]);

  return createPortal(
    <div className="undo-toast" role="status" style={{ '--undo-toast-ms': `${String(durationMs)}ms` } as CSSProperties}>
      <p className="undo-toast-message">{message}</p>
      <div className="undo-toast-actions">
        {canUndo && (
          <button type="button" className="button undo-toast-undo" disabled={busy} onClick={onUndo}>
            Undo
          </button>
        )}
        <button type="button" className="button undo-toast-close" aria-label="Dismiss" onClick={onClose}>
          ✕
        </button>
      </div>
      <span className="undo-toast-timer" aria-hidden="true" />
    </div>,
    document.body,
  );
}
