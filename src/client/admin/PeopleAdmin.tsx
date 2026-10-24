import { useCallback, useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import type { PersonWire } from '../../core/person.js';
import { PERSON_COLORS } from '../../core/personColor.js';
import type { PersonColor } from '../../core/personColor.js';
import { PersonAvatar } from '../PersonAvatar.js';
import { fetchPeople } from '../people.js';
import { PalettePicker } from './PalettePicker.js';
import { jsonRequest, sendAdmin, useAdminSession } from './session.js';

/** Long enough for a full name, short enough for a leaderboard row. */
const NAME_MAX_LENGTH = 40;

type PeopleState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; people: PersonWire[] };

/**
 * The people section of the core admin panel: everyone with their avatar,
 * inline rename and recolor, and an add form. There is no hiding or
 * removal. An edit sends no change hint: the wall picks people up on its
 * next chores refetch or the 5-minute backstop.
 */
export function PeopleAdmin() {
  const [state, setState] = useState<PeopleState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPeople(controller.signal).then(
      (body) => {
        setState({ kind: 'ready', people: body.people });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'failed', message: err instanceof Error ? err.message : 'Could not load people' });
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const people = state.kind === 'ready' ? state.people : [];

  return (
    <div className="people-admin">
      {state.kind === 'loading' && <p className="admin-message">Loading…</p>}
      {state.kind === 'failed' && (
        <p className="admin-message" data-tone="error">
          {state.message}
        </p>
      )}
      {state.kind === 'ready' &&
        (people.length === 0 ? (
          <p className="admin-message">No one yet. Add the first person below.</p>
        ) : (
          <ul className="people-list">
            {people.map((person) => (
              <PersonRow key={person.id} person={person} onChanged={reload} />
            ))}
          </ul>
        ))}
      <AddPerson people={people} onAdded={reload} />
    </div>
  );
}

function PersonRow({ person, onChanged }: { person: PersonWire; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="people-row" aria-label={person.displayName}>
      <div className="people-row-view">
        <PersonAvatar person={person} />
        <span className="people-row-name">{person.displayName}</span>
        {!editing && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {editing && (
        <EditPerson
          person={person}
          onDone={(changed) => {
            setEditing(false);
            if (changed) onChanged();
          }}
        />
      )}
    </li>
  );
}

interface PersonFormValues {
  displayName: string;
  color: PersonColor;
}

function EditPerson({ person, onDone }: { person: PersonWire; onDone: (changed: boolean) => void }) {
  const session = useAdminSession();
  const [values, setValues] = useState<PersonFormValues>({ displayName: person.displayName, color: person.color });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Only what changed.
    const patch: Partial<PersonFormValues> = {};
    const displayName = values.displayName.trim();
    if (displayName !== person.displayName) patch.displayName = displayName;
    if (values.color !== person.color) patch.color = values.color;
    if (Object.keys(patch).length === 0) {
      onDone(false);
      return;
    }
    setBusy(true);
    void sendAdmin(session, `/api/people/${String(person.id)}`, jsonRequest('PATCH', patch)).then((result) => {
      setBusy(false);
      if (result.ok) onDone(true);
      else setMessage(result.message);
    });
  };

  return (
    <form className="people-form" onSubmit={submit} aria-label={`Edit ${person.displayName}`}>
      <PersonFields values={values} onChange={setValues} idPrefix={`person-${String(person.id)}`} />
      <div className="people-form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Save
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            onDone(false);
          }}
        >
          Cancel
        </button>
      </div>
      <p className="admin-message" data-tone="error" role="status">
        {message}
      </p>
    </form>
  );
}

function AddPerson({ people, onAdded }: { people: readonly PersonWire[]; onAdded: () => void }) {
  const session = useAdminSession();
  const [values, setValues] = useState<PersonFormValues>({ displayName: '', color: PERSON_COLORS[0] });
  // Until the admin picks one, the color is the first nobody has yet.
  const [colorChosen, setColorChosen] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);
  const color = colorChosen ? values.color : firstUnusedColor(people);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = values.displayName.trim();
    setBusy(true);
    void sendAdmin(session, '/api/people', jsonRequest('POST', { displayName, color }), 201).then((result) => {
      setBusy(false);
      if (result.ok) {
        setTone('info');
        setMessage(`${displayName} added`);
        setValues({ displayName: '', color: PERSON_COLORS[0] });
        setColorChosen(false);
        onAdded();
      } else {
        setTone('error');
        setMessage(result.message);
      }
    });
  };

  return (
    <form className="people-form" onSubmit={submit} aria-label="Add a person">
      <h3 className="people-form-title">Add a person</h3>
      <PersonFields
        values={{ ...values, color }}
        onChange={(next) => {
          if (next.color !== color) setColorChosen(true);
          setValues(next);
        }}
        idPrefix="add-person"
      />
      <div className="people-form-actions">
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

function PersonFields({
  values,
  onChange,
  idPrefix,
}: {
  values: PersonFormValues;
  onChange: (values: PersonFormValues) => void;
  idPrefix: string;
}) {
  return (
    <>
      <label className="admin-field">
        Name
        <input
          className="admin-input"
          type="text"
          autoComplete="off"
          required
          // A name with only spaces would be trimmed to nothing.
          pattern=".*\S.*"
          maxLength={NAME_MAX_LENGTH}
          value={values.displayName}
          onChange={(event) => {
            onChange({ ...values, displayName: event.target.value });
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
    </>
  );
}

/** The first palette color no one has, or the first color when all are taken. */
function firstUnusedColor(people: readonly PersonWire[]): PersonColor {
  const used = new Set(people.map((person) => person.color));
  return PERSON_COLORS.find((color) => !used.has(color)) ?? PERSON_COLORS[0];
}
