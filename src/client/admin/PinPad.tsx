import { useEffect, useState } from 'react';

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

interface PinPadProps {
  title: string;
  /** Feedback under the dots: a refusal, a hint. Empty keeps the space. */
  message?: string;
  tone?: 'error' | 'info';
  /** Keys are inert while a submission is in flight. */
  busy?: boolean;
  /** Called with the four digits; the pad clears itself first. */
  onComplete: (pin: string) => void;
}

/**
 * A 4-digit entry pad: digits 0-9 and backspace, four dots, and a submit as
 * soon as the fourth digit lands. Also takes the keyboard on a laptop.
 */
export function PinPad({ title, message = '', tone = 'info', busy = false, onComplete }: PinPadProps) {
  const [digits, setDigits] = useState('');

  const press = (digit: string) => {
    if (busy || digits.length >= PIN_LENGTH) return;
    const next = digits + digit;
    if (next.length === PIN_LENGTH) {
      setDigits('');
      onComplete(next);
    } else {
      setDigits(next);
    }
  };
  const erase = () => {
    if (!busy) setDigits((current) => current.slice(0, -1));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') erase();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  return (
    <div className="pin-pad">
      <h1 className="admin-title">{title}</h1>
      <p className="pin-dots" aria-label={`${digits.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span key={index} className="pin-dot" data-filled={index < digits.length} />
        ))}
      </p>
      <p className="admin-message" data-tone={tone} role="status">
        {message}
      </p>
      <div className="pin-keys">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="pin-key"
            disabled={busy}
            onClick={() => {
              press(key);
            }}
          >
            {key}
          </button>
        ))}
        <span aria-hidden="true" />
        <button
          type="button"
          className="pin-key"
          disabled={busy}
          onClick={() => {
            press('0');
          }}
        >
          0
        </button>
        <button
          type="button"
          className="pin-key"
          aria-label="Backspace"
          disabled={busy || digits.length === 0}
          onClick={erase}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
