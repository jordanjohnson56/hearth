import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { isThemeTimes } from '../../core/theme.js';
import { clientFeatureList } from '../../features/registry.client.js';
import { setThemeTimes, useThemeTimes } from '../theme.js';
import { PinPad } from './PinPad.js';
import { readErrorMessage, useAdminSession } from './session.js';

type Status = { kind: 'loading' } | { kind: 'unreachable' } | { kind: 'ready'; pinSet: boolean };

/**
 * The core /admin route: "Set a PIN" on first run, the PIN pad while
 * locked, and once unlocked the core panel followed by each feature's admin
 * panel. The token is in the session provider, not here, so leaving the
 * route and coming back does not relock.
 */
export function AdminPage() {
  const session = useAdminSession();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/status')
      .then(async (res) => {
        if (!res.ok) throw new Error('status failed');
        return (await res.json()) as { pinSet: boolean };
      })
      .then(
        (body) => {
          if (!cancelled) setStatus({ kind: 'ready', pinSet: body.pinSet });
        },
        () => {
          if (!cancelled) setStatus({ kind: 'unreachable' });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (status.kind === 'loading') {
    return (
      <section className="admin-page" aria-label="Admin">
        <p className="admin-message">Loading…</p>
      </section>
    );
  }
  if (status.kind === 'unreachable') {
    return (
      <section className="admin-page" aria-label="Admin">
        <h1 className="admin-title">Admin</h1>
        <p className="admin-message" data-tone="error">
          Could not reach Hearth.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => {
            setStatus({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  }
  if (!status.pinSet) {
    return (
      <section className="admin-page" aria-label="Set a PIN">
        <SetPin
          onSet={() => {
            setStatus({ kind: 'ready', pinSet: true });
          }}
        />
      </section>
    );
  }
  if (session.token === null) {
    return (
      <section className="admin-page" aria-label="Unlock admin">
        <Unlock />
      </section>
    );
  }
  return (
    <section className="admin-page" aria-label="Admin">
      <Panel />
    </section>
  );
}

/** First run: choose a PIN, confirm it, save it, and unlock with it. */
function SetPin({ onSet }: { onSet: () => void }) {
  const session = useAdminSession();
  const [first, setFirst] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);

  const save = async (pin: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        setTone('error');
        setMessage(await readErrorMessage(res));
        setFirst(null);
        return;
      }
      onSet();
      await session.unlock(pin);
    } catch {
      setTone('error');
      setMessage('Could not reach Hearth');
      setFirst(null);
    } finally {
      setBusy(false);
    }
  };

  const complete = (pin: string) => {
    if (first === null) {
      setFirst(pin);
      setTone('info');
      setMessage('Enter it once more to confirm');
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setTone('error');
      setMessage('The PINs did not match. Start again');
      return;
    }
    void save(pin);
  };

  return (
    <PinPad
      title={first === null ? 'Set a PIN' : 'Confirm the PIN'}
      message={first === null && message === '' ? 'Choose four digits' : message}
      tone={tone}
      busy={busy}
      onComplete={complete}
    />
  );
}

function Unlock() {
  const session = useAdminSession();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const complete = (pin: string) => {
    setBusy(true);
    session
      .unlock(pin)
      .then((result) => {
        setMessage(result.ok ? '' : result.message);
      })
      .catch(() => {
        setMessage('Could not reach Hearth');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return <PinPad title="Enter the PIN" message={message} tone="error" busy={busy} onComplete={complete} />;
}

/** Unlocked: the core panel, then each feature's admin panel. */
function Panel() {
  const session = useAdminSession();
  const panels = clientFeatureList.flatMap((feature) =>
    feature.admin ? [{ feature, Component: feature.admin.component }] : [],
  );

  return (
    <div className="admin-panel">
      <header className="admin-panel-header">
        <h1 className="admin-title">Admin</h1>
        <button
          type="button"
          className="button"
          onClick={() => {
            void session.lock();
          }}
        >
          Lock now
        </button>
      </header>
      <section className="admin-section" aria-labelledby="admin-change-pin">
        <h2 id="admin-change-pin" className="admin-section-title">
          Change PIN
        </h2>
        <ChangePin />
      </section>
      <section className="admin-section" aria-labelledby="admin-theme">
        <h2 id="admin-theme" className="admin-section-title">
          Theme
        </h2>
        <ThemeTimesForm />
      </section>
      {panels.map(({ feature, Component }) => (
        <section key={feature.id} className="admin-section" aria-labelledby={`admin-${feature.id}`}>
          <h2 id={`admin-${feature.id}`} className="admin-section-title">
            {feature.name}
          </h2>
          <Component />
        </section>
      ))}
    </div>
  );
}

function ChangePin() {
  const session = useAdminSession();
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    session
      .authFetch('/api/admin/pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, currentPin }),
      })
      .then(async (res) => {
        if (res.ok) {
          setTone('info');
          setMessage('PIN changed');
          setCurrentPin('');
          setPin('');
        } else {
          setTone('error');
          setMessage(await readErrorMessage(res));
        }
      })
      .catch(() => {
        setTone('error');
        setMessage('Could not reach Hearth');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className="admin-form" onSubmit={submit}>
      <label className="admin-field">
        Current PIN
        <input
          className="admin-input admin-input-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4}"
          maxLength={4}
          required
          value={currentPin}
          onChange={(event) => {
            setCurrentPin(event.target.value);
          }}
        />
      </label>
      <label className="admin-field">
        New PIN
        <input
          className="admin-input admin-input-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4}"
          maxLength={4}
          required
          value={pin}
          onChange={(event) => {
            setPin(event.target.value);
          }}
        />
      </label>
      <button type="submit" className="button button-primary" disabled={busy}>
        Save
      </button>
      <p className="admin-message" data-tone={tone} role="status">
        {message}
      </p>
    </form>
  );
}

/**
 * The switch times. A save applies on this device the moment the server
 * confirms it (the wall picks it up on its next backstop).
 */
function ThemeTimesForm() {
  const session = useAdminSession();
  const inUse = useThemeTimes();
  const [lightFrom, setLightFrom] = useState(inUse.lightFrom);
  const [darkFrom, setDarkFrom] = useState(inUse.darkFrom);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    session
      .authFetch('/api/settings/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lightFrom, darkFrom }),
      })
      .then(async (res) => {
        if (res.ok) {
          const body: unknown = await res.json();
          if (isThemeTimes(body)) setThemeTimes(body);
          setTone('info');
          setMessage('Theme times saved');
        } else {
          setTone('error');
          setMessage(await readErrorMessage(res));
        }
      })
      .catch(() => {
        setTone('error');
        setMessage('Could not reach Hearth');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className="admin-form" onSubmit={submit}>
      <label className="admin-field">
        Light from
        <input
          className="admin-input admin-input-time"
          type="time"
          required
          value={lightFrom}
          onChange={(event) => {
            setLightFrom(event.target.value);
          }}
        />
      </label>
      <label className="admin-field">
        Dark from
        <input
          className="admin-input admin-input-time"
          type="time"
          required
          value={darkFrom}
          onChange={(event) => {
            setDarkFrom(event.target.value);
          }}
        />
      </label>
      <button type="submit" className="button button-primary" disabled={busy}>
        Save
      </button>
      <p className="admin-message" data-tone={tone} role="status">
        {message}
      </p>
    </form>
  );
}
