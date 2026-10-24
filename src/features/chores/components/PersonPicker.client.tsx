import { useEffect, useRef } from 'react';
import { PersonAvatar } from '../../../client/PersonAvatar.js';
import type { PersonWire } from '../../../core/person.js';
import '../claim.css';

export interface PersonPickerProps {
  /** The chore being claimed, for the heading ("Who did Feed the dog?"). */
  choreName: string;
  people: readonly PersonWire[];
  /** True while the claim is being sent: every choice is disabled. */
  busy: boolean;
  /** Why the last attempt failed, shown under the choices. */
  error: string | undefined;
  onPick: (person: PersonWire) => void;
  /** Cancel, Escape or a tap on the backdrop. */
  onCancel: () => void;
}

/**
 * The claim's second tap: a modal dialog of everyone, avatar and name, each
 * a large target so a child who cannot read yet still finds themself.
 * Mount it to open it; unmount it to close it.
 */
export function PersonPicker({ choreName, people, busy, error, onPick, onCancel }: PersonPickerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    // The top layer escapes the tile's clipping, and showModal traps focus.
    if (!element.open) element.showModal();
    return () => {
      element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="claim-picker"
      aria-labelledby="claim-picker-heading"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // A click on the dialog itself, not its content, is the backdrop.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="claim-picker-body">
        <h2 id="claim-picker-heading" className="claim-picker-heading">
          Who did {choreName}?
        </h2>
        {people.length === 0 ? (
          <p className="claim-picker-note">No one is set up yet. Add people in Admin.</p>
        ) : (
          <ul className="claim-picker-people">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="claim-picker-person"
                  disabled={busy}
                  onClick={() => {
                    onPick(person);
                  }}
                >
                  <PersonAvatar person={person} />
                  <span className="claim-picker-name">{person.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error !== undefined && (
          <p className="claim-picker-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="button claim-picker-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
