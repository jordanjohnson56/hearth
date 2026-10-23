import { useState } from 'react';
import { readErrorMessage, useAdminSession } from '../../../client/admin/session.js';
import type { AdminSession } from '../../../client/admin/session.js';
import { readJson } from '../../../client/http.js';
import { PersonAvatar } from '../../../client/PersonAvatar.js';
import { useFeatureData } from '../../../client/useFeatureData.js';
import { configuredZone } from '../../../client/zone.js';
import type { PersonWire } from '../../../core/person.js';
import { pointsText } from '../components/boardText.js';
import { PersonPicker } from '../components/PersonPicker.client.js';
import type { AdminCompletionWire, ClaimInputWire, CompletionsResponse } from '../types.js';
import '../chores.css';

const zone = configuredZone();

function fetchCompletions(session: AdminSession, signal: AbortSignal): Promise<CompletionsResponse> {
  return session.authFetch('/api/chores/completions?days=14', { signal }).then((res) => {
    if (!res.ok) throw new Error(`Could not load the completions (${String(res.status)})`);
    return readJson<CompletionsResponse>(res);
  });
}

const VOID_REASON_TEXT: Record<NonNullable<AdminCompletionWire['voided']>['reason'], string> = {
  undo: 'Voided: undone at the wall',
  correction: 'Voided: correction',
};

/**
 * The correction list of the chores admin panel: every completion of the
 * last 14 days, newest first. A voided one is struck through with its
 * reason; one that counts offers Void (after a confirming tap) and Reassign
 * (the shared person picker, without the person who has it now). A `chores`
 * hint refetches it, so a claim at the wall shows up here at once.
 */
export function CompletionsAdmin() {
  const session = useAdminSession();
  const { data, error, refetch } = useFeatureData('chores', (signal) => fetchCompletions(session, signal));
  const [reassigning, setReassigning] = useState<
    { completion: AdminCompletionWire; busy: boolean; error: string | undefined } | undefined
  >(undefined);

  const people = new Map(data?.people.map((person) => [person.id, person]));

  const reassign = async (completion: AdminCompletionWire, person: PersonWire) => {
    setReassigning({ completion, busy: true, error: undefined });
    try {
      const body: ClaimInputWire = { personId: person.id };
      const res = await session.authFetch(
        `/api/chores/completions/${String(completion.id)}/reassign`,
        jsonPost(body),
      );
      if (res.status === 201) setReassigning(undefined);
      else setReassigning({ completion, busy: false, error: await readErrorMessage(res) });
    } catch {
      setReassigning({ completion, busy: false, error: 'Could not reach Hearth' });
    }
    refetch();
  };

  return (
    <div className="chores-completions">
      <h3 className="chores-form-title">Completions, last 14 days</h3>
      {data === undefined ? (
        <p className="admin-message" data-tone={error === undefined ? 'info' : 'error'}>
          {error ?? 'Loading…'}
        </p>
      ) : data.completions.length === 0 ? (
        <p className="admin-message">No completions in the last 14 days.</p>
      ) : (
        <ul className="chores-completion-list">
          {data.completions.map((completion) => (
            <CompletionRow
              key={completion.id}
              completion={completion}
              person={people.get(completion.personId)}
              onReassign={() => {
                setReassigning({ completion, busy: false, error: undefined });
              }}
              onChanged={refetch}
            />
          ))}
        </ul>
      )}
      {reassigning !== undefined && data !== undefined && (
        <PersonPicker
          choreName={reassigning.completion.choreName}
          people={data.people.filter((person) => person.id !== reassigning.completion.personId)}
          busy={reassigning.busy}
          error={reassigning.error}
          onPick={(person) => void reassign(reassigning.completion, person)}
          onCancel={() => {
            setReassigning(undefined);
          }}
        />
      )}
    </div>
  );
}

function CompletionRow({
  completion,
  person,
  onReassign,
  onChanged,
}: {
  completion: AdminCompletionWire;
  person: PersonWire | undefined;
  onReassign: () => void;
  onChanged: () => void;
}) {
  const session = useAdminSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const voided = completion.voided;
  const name = person?.displayName ?? 'Someone';

  const voidIt = async () => {
    setBusy(true);
    setMessage('');
    try {
      const res = await session.authFetch(`/api/chores/completions/${String(completion.id)}/void`, {
        method: 'POST',
      });
      if (res.status !== 204) setMessage(await readErrorMessage(res));
    } catch {
      setMessage('Could not reach Hearth');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
    onChanged();
  };

  return (
    <li
      className="chores-completion"
      data-voided={voided !== null}
      aria-label={`${completion.choreName} by ${name}, ${formatInstant(completion.completedAt)}${voided === null ? '' : `, ${VOID_REASON_TEXT[voided.reason].toLowerCase()}`}`}
    >
      <div className="chores-completion-summary">
        {person !== undefined && <PersonAvatar person={person} />}
        <div className="chores-completion-text">
          <p className="chores-completion-line">
            {voided === null ? (
              <CompletionText completion={completion} name={name} />
            ) : (
              <s>
                <CompletionText completion={completion} name={name} />
              </s>
            )}
          </p>
          <p className="chores-completion-detail">
            <time dateTime={new Date(completion.completedAt).toISOString()}>
              {formatInstant(completion.completedAt)}
            </time>
            {voided !== null && (
              <span className="chores-row-tag chores-completion-reason">{VOID_REASON_TEXT[voided.reason]}</span>
            )}
          </p>
        </div>
      </div>
      {voided === null && (
        <div className="chores-row-actions">
          {confirming ? (
            <>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void voidIt()}>
                Void it
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Void
              </button>
              <button type="button" className="button" onClick={onReassign}>
                Reassign
              </button>
            </>
          )}
        </div>
      )}
      {message !== '' && (
        <p className="admin-message" data-tone="error" role="status">
          {message}
        </p>
      )}
    </li>
  );
}

function CompletionText({ completion, name }: { completion: AdminCompletionWire; name: string }) {
  return (
    <>
      <span className="chores-completion-chore">{completion.choreName}</span>
      {' · '}
      {name}
      {' · '}
      {pointsText(completion.pointsAwarded)}
    </>
  );
}

const instantFormat = new Intl.DateTimeFormat(undefined, {
  timeZone: zone,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Fri, Oct 23, 11:00 AM" in the configured zone. */
function formatInstant(instant: number): string {
  return instantFormat.format(new Date(instant));
}

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
