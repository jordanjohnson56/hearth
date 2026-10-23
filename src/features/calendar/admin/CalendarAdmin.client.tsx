import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { PalettePicker } from '../../../client/admin/PalettePicker.js';
import { readErrorMessage, useAdminSession } from '../../../client/admin/session.js';
import { readJson } from '../../../client/http.js';
import { useFeatureData } from '../../../client/useFeatureData.js';
import { configuredZone } from '../../../client/zone.js';
import { formatTime } from '../../../core/clock.js';
import { PERSON_COLORS } from '../../../core/personColor.js';
import type { PersonColor } from '../../../core/personColor.js';
import type { FetchFailure, SourceWire, SourcesResponse } from '../types.js';
import '../calendar.css';

const zone = configuredZone();

async function fetchSources(signal: AbortSignal): Promise<SourcesResponse> {
  const res = await fetch('/api/calendar/sources', { signal });
  if (!res.ok) throw new Error(`Could not load calendars (${String(res.status)})`);
  return readJson<SourcesResponse>(res);
}

/**
 * The calendar section of the unlocked admin panel: every source with its
 * fetch status, an add form, inline edit, refresh now and delete with a
 * confirmation. The address is typed once and never shown again; rows
 * carry the fingerprint instead.
 */
export function CalendarAdmin() {
  const { data, error, refetch } = useFeatureData('calendar', fetchSources);

  return (
    <div className="calendar-admin">
      {data === undefined ? (
        <p className="admin-message" data-tone={error === undefined ? 'info' : 'error'}>
          {error ?? 'Loading…'}
        </p>
      ) : data.sources.length === 0 ? (
        <p className="admin-message">No calendars yet. Paste a secret address below to add one.</p>
      ) : (
        <ul className="calendar-sources">
          {data.sources.map((source) => (
            <SourceRow key={source.id} source={source} onChanged={refetch} />
          ))}
        </ul>
      )}
      <AddSource onAdded={refetch} />
    </div>
  );
}

type RowMode = { kind: 'view' } | { kind: 'edit' } | { kind: 'confirm-delete' };

function SourceRow({ source, onChanged }: { source: SourceWire; onChanged: () => void }) {
  const session = useAdminSession();
  const [mode, setMode] = useState<RowMode>({ kind: 'view' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const act = async (run: () => Promise<Response>) => {
    setBusy(true);
    setMessage('');
    try {
      const res = await run();
      if (!res.ok) {
        setMessage(await readErrorMessage(res));
        return false;
      }
      onChanged();
      return true;
    } catch {
      setMessage('Could not reach Hearth');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const refreshNow = () =>
    act(() => session.authFetch(`/api/calendar/sources/${String(source.id)}/refresh`, { method: 'POST' }));

  const remove = async () => {
    if (await act(() => session.authFetch(`/api/calendar/sources/${String(source.id)}`, { method: 'DELETE' }))) {
      setMode({ kind: 'view' });
    }
  };

  return (
    <li className="calendar-source" aria-label={source.label}>
      <h3 className="calendar-source-heading">
        <span className="calendar-source-dot" style={{ background: `var(--person-${source.color})` }} aria-hidden="true" />
        <span className="calendar-source-label">{source.label}</span>
      </h3>
      {mode.kind === 'view' && (
        <div className="calendar-source-actions">
          <button type="button" className="button" disabled={busy} onClick={() => { setMode({ kind: 'edit' }); }}>
            Edit
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => { void refreshNow(); }}>
            Refresh now
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => { setMode({ kind: 'confirm-delete' }); }}>
            Delete
          </button>
        </div>
      )}
      <SourceStatus source={source} />
      {mode.kind === 'confirm-delete' && (
        <p className="calendar-source-confirm" role="alertdialog" aria-label={`Delete ${source.label}?`}>
          <span>Delete {source.label} and its events?</span>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => { void remove(); }}>
            Delete
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => { setMode({ kind: 'view' }); }}>
            Keep
          </button>
        </p>
      )}
      {mode.kind === 'edit' && (
        <EditSource
          source={source}
          onDone={(changed) => {
            setMode({ kind: 'view' });
            if (changed) onChanged();
          }}
        />
      )}
      {message !== '' && (
        <p className="admin-message" data-tone="error" role="status">
          {message}
        </p>
      )}
    </li>
  );
}

function SourceStatus({ source }: { source: SourceWire }) {
  return (
    <dl className="calendar-source-status">
      <div>
        <dt>Address</dt>
        <dd>{source.fingerprint}</dd>
      </div>
      <div>
        <dt>Last success</dt>
        <dd>{source.lastSuccessAt === null ? 'Not yet fetched' : formatInstant(source.lastSuccessAt)}</dd>
      </div>
      <div>
        <dt>Last attempt</dt>
        <dd>{source.lastAttemptAt === null ? 'None' : formatInstant(source.lastAttemptAt)}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd data-tone={source.lastError === null ? undefined : 'error'}>
          {source.lastError === null ? 'OK' : describeFailure(source.lastError)}
        </dd>
      </div>
      {source.skippedCount > 0 && (
        <div>
          <dt>Skipped</dt>
          <dd data-tone="error">{describeSkipped(source.skippedCount)}</dd>
        </div>
      )}
    </dl>
  );
}

/** The row's line for VEVENTs the last fetch could not read. */
function describeSkipped(count: number): string {
  return `${String(count)} ${count === 1 ? 'event' : 'events'} could not be read`;
}

interface SourceFormValues {
  label: string;
  color: PersonColor;
  url: string;
}

function AddSource({ onAdded }: { onAdded: () => void }) {
  const session = useAdminSession();
  const [values, setValues] = useState<SourceFormValues>({ label: '', color: PERSON_COLORS[0], url: '' });
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    session
      .authFetch('/api/calendar/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      .then(async (res) => {
        if (res.status === 201) {
          const source = await readJson<SourceWire>(res);
          setTone('info');
          setMessage(
            source.lastError === null
              ? `${source.label} added and fetched`
              : `${source.label} added, but the first fetch failed: ${describeFailure(source.lastError)}`,
          );
          setValues({ label: '', color: PERSON_COLORS[0], url: '' });
          onAdded();
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
    <form className="calendar-form" onSubmit={submit} aria-label="Add a calendar">
      <h3 className="calendar-form-title">Add a calendar</h3>
      <SourceFields values={values} onChange={setValues} idPrefix="add" urlRequired />
      <div className="calendar-form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Add
        </button>
      </div>
      <p className="admin-message" data-tone={tone} role="status">
        {message}
      </p>
    </form>
  );
}

function EditSource({ source, onDone }: { source: SourceWire; onDone: (changed: boolean) => void }) {
  const session = useAdminSession();
  const [values, setValues] = useState<SourceFormValues>({ label: source.label, color: source.color, url: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Only what changed; an empty address keeps the current one.
    const patch: Partial<SourceFormValues> = {};
    if (values.label !== source.label) patch.label = values.label;
    if (values.color !== source.color) patch.color = values.color;
    if (values.url.trim() !== '') patch.url = values.url;
    if (Object.keys(patch).length === 0) {
      onDone(false);
      return;
    }
    setBusy(true);
    session
      .authFetch(`/api/calendar/sources/${String(source.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      .then(async (res) => {
        if (res.ok) onDone(true);
        else setMessage(await readErrorMessage(res));
      })
      .catch(() => {
        setMessage('Could not reach Hearth');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className="calendar-form" onSubmit={submit} aria-label={`Edit ${source.label}`}>
      <SourceFields values={values} onChange={setValues} idPrefix={`edit-${String(source.id)}`} urlRequired={false} />
      <div className="calendar-form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Save
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => { onDone(false); }}>
          Cancel
        </button>
      </div>
      <p className="admin-message" data-tone="error" role="status">
        {message}
      </p>
    </form>
  );
}

function SourceFields({
  values,
  onChange,
  idPrefix,
  urlRequired,
}: {
  values: SourceFormValues;
  onChange: (values: SourceFormValues) => void;
  idPrefix: string;
  urlRequired: boolean;
}) {
  return (
    <>
      <label className="admin-field">
        Label
        <input
          className="admin-input calendar-input"
          type="text"
          autoComplete="off"
          required
          maxLength={60}
          value={values.label}
          onChange={(event) => {
            onChange({ ...values, label: event.target.value });
          }}
        />
      </label>
      <PalettePicker
        name={`${idPrefix}-color`}
        value={values.color}
        onChange={(color) => {
          onChange({ ...values, color });
        }}
      />
      <label className="admin-field calendar-field-url">
        {urlRequired ? 'Secret address' : 'New secret address (leave empty to keep)'}
        <input
          className="admin-input calendar-input"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://…"
          required={urlRequired}
          value={values.url}
          onChange={(event) => {
            onChange({ ...values, url: event.target.value });
          }}
        />
      </label>
    </>
  );
}

const FAILURE_TEXT: Record<Exclude<FetchFailure, `http ${number}`>, string> = {
  timeout: 'Timed out',
  'not-ics': 'Not a calendar feed',
  'too-large': 'Feed is too large',
  network: 'Could not connect',
  'redirected-away':
    'The address sends Hearth to another site, usually a sign-in page. Paste the "Secret address in iCal format" instead.',
};

/** The classification as a short line for the row. */
function describeFailure(failure: FetchFailure): string {
  if (failure.startsWith('http ')) return `Server answered ${failure.slice('http '.length)}`;
  return FAILURE_TEXT[failure as keyof typeof FAILURE_TEXT];
}

const dayFormat = new Intl.DateTimeFormat(undefined, { timeZone: zone, month: 'short', day: 'numeric' });

/** `Oct 23, 3:00 PM`: the time half as the header clock shows it. */
function formatInstant(epochMs: number): string {
  const instant = new Date(epochMs);
  return `${dayFormat.format(instant)}, ${formatTime(instant, zone)}`;
}
