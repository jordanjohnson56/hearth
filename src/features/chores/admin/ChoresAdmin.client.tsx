import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { jsonRequest, sendAdmin, useAdminSession } from '../../../client/admin/session.js';
import type { AdminResult, AdminSession } from '../../../client/admin/session.js';
import { readJson } from '../../../client/http.js';
import { useFeatureData } from '../../../client/useFeatureData.js';
import { configuredZone } from '../../../client/zone.js';
import { atUtcMidnight, localDateOf, partsOf } from '../../../core/localDateText.js';
import { pointsText } from '../components/boardText.js';
import { WEEKDAYS } from '../rule.js';
import type { RecurrenceRule, RuleKind, Weekday } from '../rule.js';
import type { ChoreInputWire, ChorePatchWire, ChoreWire, DefinitionsResponse } from '../types.js';
import { CompletionsAdmin } from './CompletionsAdmin.client.js';
import '../chores.css';

const zone = configuredZone();

function fetchDefinitions(session: AdminSession, signal: AbortSignal): Promise<DefinitionsResponse> {
  return session.authFetch('/api/chores/definitions', { signal }).then((res) => {
    if (!res.ok) throw new Error(`Could not load chores (${String(res.status)})`);
    return readJson<DefinitionsResponse>(res);
  });
}

/**
 * The chores section of the unlocked admin panel: every chore with its rule
 * and points, an add form, inline edit, archive and unarchive, and a toggle
 * that shows the archived ones. The rule is chosen with buttons; the server
 * checks it again and its message is shown under the form. Below them, the
 * last 14 days of completions with Void and Reassign (CompletionsAdmin).
 */
export function ChoresAdmin() {
  const session = useAdminSession();
  const { data, error, refetch } = useFeatureData('chores', (signal) => fetchDefinitions(session, signal));
  const [showArchived, setShowArchived] = useState(false);

  const archivedCount = data?.chores.filter((chore) => chore.archivedAt !== null).length ?? 0;
  const shown = data?.chores.filter((chore) => showArchived || chore.archivedAt === null) ?? [];

  return (
    <div className="chores-admin">
      <div className="chores-admin-toolbar">
        <button
          type="button"
          className="button"
          aria-pressed={showArchived}
          onClick={() => {
            setShowArchived((value) => !value);
          }}
        >
          {showArchived ? 'Hide archived' : `Show archived (${String(archivedCount)})`}
        </button>
      </div>
      {data === undefined ? (
        <p className="admin-message" data-tone={error === undefined ? 'info' : 'error'}>
          {error ?? 'Loading…'}
        </p>
      ) : shown.length === 0 ? (
        <p className="admin-message">
          {data.chores.length === 0 ? 'No chores yet. Add the first one below.' : 'Every chore is archived.'}
        </p>
      ) : (
        <ul className="chores-list">
          {shown.map((chore) => (
            <ChoreRow key={chore.id} chore={chore} onChanged={refetch} />
          ))}
        </ul>
      )}
      <AddChore onAdded={refetch} />
      <CompletionsAdmin />
    </div>
  );
}

function ChoreRow({ chore, onChanged }: { chore: ChoreWire; onChanged: () => void }) {
  const session = useAdminSession();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const archived = chore.archivedAt !== null;

  const setArchived = async (value: boolean) => {
    setBusy(true);
    setMessage('');
    const result = await patchChore(session, chore.id, { archived: value });
    setBusy(false);
    if (result.ok) onChanged();
    else setMessage(result.message);
  };

  return (
    <li className="chores-row" aria-label={chore.name} data-archived={archived}>
      <div className="chores-row-summary">
        <h3 className="chores-row-name">
          {chore.name}
          {archived && <span className="chores-row-tag">Archived</span>}
        </h3>
        <p className="chores-row-detail">
          <span>{describeRule(chore.rule)}</span>
          <span>{pointsText(chore.points)}</span>
          <span>from {formatDate(chore.startDate)}</span>
        </p>
      </div>
      {!editing && (
        <div className="chores-row-actions">
          <button type="button" className="button" disabled={busy} onClick={() => { setEditing(true); }}>
            Edit
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => { void setArchived(!archived); }}>
            {archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      )}
      {editing && (
        <EditChore
          chore={chore}
          onDone={(changed) => {
            setEditing(false);
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

/** What the form edits: every kind's fields at once, so switching kind loses nothing. */
interface ChoreFormValues {
  name: string;
  kind: RuleKind;
  days: Weekday[];
  everyUnit: 'days' | 'weeks';
  everyInterval: string;
  monthDay: string;
  points: string;
  startDate: string;
}

function initialValues(today: string): ChoreFormValues {
  return {
    name: '',
    kind: 'daily',
    days: [weekdayTokenOf(today)],
    everyUnit: 'weeks',
    everyInterval: '2',
    monthDay: String(partsOf(today).day),
    points: '1',
    startDate: today,
  };
}

function valuesOf(chore: ChoreWire): ChoreFormValues {
  const base = { ...initialValues(chore.startDate), name: chore.name, points: String(chore.points) };
  const rule = chore.rule;
  switch (rule.kind) {
    case 'weekly':
      return { ...base, kind: rule.kind, days: rule.days };
    case 'every':
      return { ...base, kind: rule.kind, everyUnit: rule.unit, everyInterval: String(rule.interval) };
    case 'monthly':
      return { ...base, kind: rule.kind, monthDay: String(rule.day) };
    case 'daily':
    case 'whenever':
      return { ...base, kind: rule.kind };
  }
}

/**
 * The rule the form describes. Numbers go as typed (a blank field as NaN,
 * which JSON sends as null), so the server's message is the one shown.
 */
function ruleOf(values: ChoreFormValues): RecurrenceRule {
  switch (values.kind) {
    case 'daily':
    case 'whenever':
      return { kind: values.kind };
    case 'weekly':
      return { kind: 'weekly', days: values.days };
    case 'every':
      return { kind: 'every', unit: values.everyUnit, interval: Number(values.everyInterval || NaN) };
    case 'monthly':
      return { kind: 'monthly', day: Number(values.monthDay || NaN) };
  }
}

function inputOf(values: ChoreFormValues): ChoreInputWire {
  return {
    name: values.name.trim(),
    rule: ruleOf(values),
    points: Number(values.points || NaN),
    startDate: values.startDate,
  };
}

function AddChore({ onAdded }: { onAdded: () => void }) {
  const session = useAdminSession();
  const [values, setValues] = useState(() => initialValues(localDateOf(new Date(), zone)));
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    const result = await sendAdmin(session, '/api/chores/definitions', jsonRequest('POST', inputOf(values)), 201);
    setBusy(false);
    if (result.ok) {
      const chore = await readJson<ChoreWire>(result.res);
      setTone('info');
      setMessage(`${chore.name} added`);
      setValues(initialValues(localDateOf(new Date(), zone)));
      onAdded();
    } else {
      setTone('error');
      setMessage(result.message);
    }
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void add();
  };

  return (
    <form className="chores-form" onSubmit={submit} aria-label="Add a chore">
      <h3 className="chores-form-title">Add a chore</h3>
      <ChoreFields values={values} onChange={setValues} idPrefix="add" />
      <div className="chores-form-actions">
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

function EditChore({ chore, onDone }: { chore: ChoreWire; onDone: (changed: boolean) => void }) {
  const session = useAdminSession();
  const [values, setValues] = useState(() => valuesOf(chore));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Only what changed.
    const input = inputOf(values);
    const patch: ChorePatchWire = {};
    if (input.name !== chore.name) patch.name = input.name;
    if (JSON.stringify(input.rule) !== JSON.stringify(chore.rule)) patch.rule = input.rule;
    if (input.points !== chore.points) patch.points = input.points;
    if (input.startDate !== chore.startDate) patch.startDate = values.startDate;
    if (Object.keys(patch).length === 0) {
      onDone(false);
      return;
    }
    setBusy(true);
    void patchChore(session, chore.id, patch).then((result) => {
      setBusy(false);
      if (result.ok) onDone(true);
      else setMessage(result.message);
    });
  };

  return (
    <form className="chores-form" onSubmit={submit} aria-label={`Edit ${chore.name}`}>
      <ChoreFields values={values} onChange={setValues} idPrefix={`edit-${String(chore.id)}`} />
      <div className="chores-form-actions">
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

const KIND_LABELS: Record<RuleKind, string> = {
  daily: 'Daily',
  weekly: 'Weekdays',
  every: 'Every N',
  monthly: 'Monthly',
  whenever: 'Whenever',
};

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

function ChoreFields({
  values,
  onChange,
  idPrefix,
}: {
  values: ChoreFormValues;
  onChange: (values: ChoreFormValues) => void;
  idPrefix: string;
}) {
  const set = (change: Partial<ChoreFormValues>) => {
    onChange({ ...values, ...change });
  };

  return (
    <>
      <label className="admin-field chores-field-name">
        Name
        <input
          className="admin-input chores-input"
          type="text"
          autoComplete="off"
          required
          maxLength={60}
          value={values.name}
          onChange={(event) => {
            set({ name: event.target.value });
          }}
        />
      </label>
      <fieldset className="chores-choice">
        <legend>Repeats</legend>
        <div className="chores-options">
          {(Object.keys(KIND_LABELS) as RuleKind[]).map((kind) => (
            <label key={kind} className="chores-option">
              <input
                type="radio"
                name={`${idPrefix}-kind`}
                value={kind}
                checked={values.kind === kind}
                onChange={() => {
                  set({ kind });
                }}
              />
              <span>{KIND_LABELS[kind]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {values.kind === 'weekly' && (
        <fieldset className="chores-choice">
          <legend>On</legend>
          <div className="chores-options">
            {WEEKDAYS.map((day) => (
              <label key={day} className="chores-option chores-option-day">
                <input
                  type="checkbox"
                  checked={values.days.includes(day)}
                  onChange={(event) => {
                    const days = event.target.checked
                      ? WEEKDAYS.filter((d) => d === day || values.days.includes(d))
                      : values.days.filter((d) => d !== day);
                    set({ days });
                  }}
                />
                <span>{WEEKDAY_LABELS[day]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {values.kind === 'every' && (
        <div className="chores-every">
          <label className="admin-field chores-field-number">
            Every
            <input
              className="admin-input chores-input"
              type="number"
              inputMode="numeric"
              min={2}
              step={1}
              required
              value={values.everyInterval}
              onChange={(event) => {
                set({ everyInterval: event.target.value });
              }}
            />
          </label>
          <fieldset className="chores-choice chores-choice-inline">
            <legend className="visually-hidden">Unit</legend>
            <div className="chores-options">
              {(['days', 'weeks'] as const).map((unit) => (
                <label key={unit} className="chores-option">
                  <input
                    type="radio"
                    name={`${idPrefix}-unit`}
                    value={unit}
                    checked={values.everyUnit === unit}
                    onChange={() => {
                      set({ everyUnit: unit });
                    }}
                  />
                  <span>{unit === 'days' ? 'Days' : 'Weeks'}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
      {values.kind === 'monthly' && (
        <label className="admin-field chores-field-number">
          Day of the month
          <input
            className="admin-input chores-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            step={1}
            required
            value={values.monthDay}
            onChange={(event) => {
              set({ monthDay: event.target.value });
            }}
          />
        </label>
      )}
      <p className="chores-rule-preview">{describeRule(ruleOf(values))}</p>
      <label className="admin-field chores-field-number">
        Points
        <input
          className="admin-input chores-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          step={1}
          required
          value={values.points}
          onChange={(event) => {
            set({ points: event.target.value });
          }}
        />
      </label>
      <label className="admin-field chores-field-date">
        Start date
        <input
          className="admin-input chores-input"
          type="date"
          required
          value={values.startDate}
          onChange={(event) => {
            set({ startDate: event.target.value });
          }}
        />
      </label>
    </>
  );
}

function patchChore(session: AdminSession, id: number, patch: ChorePatchWire): Promise<AdminResult> {
  return sendAdmin(session, `/api/chores/definitions/${String(id)}`, jsonRequest('PATCH', patch));
}

/** The rule's weekday token for a `YYYY-MM-DD`. */
function weekdayTokenOf(date: string): Weekday {
  // getUTCDay is 0 for Sunday; WEEKDAYS starts on Monday.
  return WEEKDAYS[(atUtcMidnight(date).getUTCDay() + 6) % 7] ?? 'mon';
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${String(n)}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${String(n)}${suffix}`;
}

/** A rule as a short line for a row: "Weekly on Mon, Thu", "Every 2 weeks". */
function describeRule(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case 'daily':
      return 'Every day';
    case 'weekly':
      return rule.days.length === 0
        ? 'Weekly (choose a day)'
        : `Weekly on ${rule.days.map((day) => WEEKDAY_LABELS[day]).join(', ')}`;
    case 'every':
      return Number.isInteger(rule.interval) && rule.interval >= 2
        ? `Every ${String(rule.interval)} ${rule.unit}`
        : `Every N ${rule.unit}`;
    case 'monthly':
      if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31) return 'Monthly';
      return rule.day > 28
        ? `Monthly on the ${ordinal(rule.day)} (or the month's last day)`
        : `Monthly on the ${ordinal(rule.day)}`;
    case 'whenever':
      return 'Whenever (anytime, once a day at most)';
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/** `Oct 1, 2026` for a `YYYY-MM-DD`. */
function formatDate(date: string): string {
  return dateFormat.format(atUtcMidnight(date));
}
