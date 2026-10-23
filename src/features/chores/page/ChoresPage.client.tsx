import type { ReactNode } from 'react';
import { PersonAvatar } from '../../../client/PersonAvatar.js';
import { configuredZone } from '../../../client/zone.js';
import { lateness, pointsText } from '../components/boardText.js';
import { useClaimFlow } from '../components/useClaimFlow.client.js';
import type { AnytimeChoreWire, BoardResponse, WaitingChoreWire } from '../types.js';
import { useBoard } from '../useBoard.client.js';
import { completedText, nextDueText } from './pageText.js';
import '../choresPage.css';

const zone = configuredZone();

/**
 * The Chores view: the whole board in four sections. Waiting (the pool,
 * uncapped, in the tile's order) and Anytime claim through the same flow
 * as the Chores today tile; Upcoming and this week's Recent completions
 * are read-only. The tile's "+N more" link lands here.
 */
export function ChoresPage() {
  const { data, error, refetch } = useBoard();
  const claim = useClaimFlow(data?.people ?? [], refetch);

  return (
    <section className="chores-page" aria-labelledby="chores-page-title">
      <h1 id="chores-page-title" className="chores-page-title">
        Chores
      </h1>
      {data === undefined ? (
        <p className="chores-page-note">{error === undefined ? 'Loading…' : 'The chores could not be loaded.'}</p>
      ) : (
        <div className="chores-page-sections">
          <Waiting chores={data.waiting} onClaim={claim.start} />
          <Anytime chores={data.anytime} onClaim={claim.start} />
          <Upcoming board={data} />
          <Recent board={data} />
        </div>
      )}
      {claim.ui}
    </section>
  );
}

type Area = 'waiting' | 'anytime' | 'upcoming' | 'recent';

function Section({ area, title, count, children }: { area: Area; title: string; count: number; children: ReactNode }) {
  const id = `chores-${area}`;
  return (
    <section className="chores-page-section" data-area={area} aria-labelledby={id}>
      <h2 id={id} className="chores-page-heading">
        {title}
        {count > 0 && <span className="chores-page-count"> {count}</span>}
      </h2>
      {children}
    </section>
  );
}

/** A row's text: the chore's name, over what else the section says about it (how late, when, who). */
function Detail({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <span className="chores-page-detail">
      <span className="chores-page-name">{name}</span>
      {children !== undefined && children !== false && <span className="chores-page-meta">{children}</span>}
    </span>
  );
}

function Waiting({ chores, onClaim }: { chores: WaitingChoreWire[]; onClaim: (chore: WaitingChoreWire) => void }) {
  return (
    <Section area="waiting" title="Waiting" count={chores.length}>
      {chores.length === 0 ? (
        <p className="chores-page-note">Nothing is waiting. Every chore is done for now.</p>
      ) : (
        <ul className="chores-page-list">
          {chores.map((chore) => {
            const late = lateness(chore);
            return (
              <li key={chore.id}>
                <button
                  type="button"
                  className="chores-page-row"
                  data-overdue={chore.state === 'overdue' ? '' : undefined}
                  onClick={() => {
                    onClaim(chore);
                  }}
                >
                  <Detail name={chore.name}>
                    {late !== undefined && <span className="chores-page-late">{late}</span>}
                  </Detail>
                  <span className="chores-page-points">{pointsText(chore.points)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Anytime({ chores, onClaim }: { chores: AnytimeChoreWire[]; onClaim: (chore: AnytimeChoreWire) => void }) {
  return (
    <Section area="anytime" title="Anytime" count={chores.length}>
      {chores.length === 0 ? (
        <p className="chores-page-note">No anytime chores. Add one in Admin with the rule Whenever.</p>
      ) : (
        <ul className="chores-page-list">
          {chores.map((chore) => (
            <li key={chore.id}>
              {chore.claimedToday ? (
                // Claimable again tomorrow: shown, but not a target.
                <div className="chores-page-row" data-done="">
                  <Detail name={chore.name}>Done today</Detail>
                  <span className="chores-page-points">{pointsText(chore.points)}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="chores-page-row"
                  onClick={() => {
                    onClaim(chore);
                  }}
                >
                  <Detail name={chore.name} />
                  <span className="chores-page-points">{pointsText(chore.points)}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Upcoming({ board }: { board: BoardResponse }) {
  return (
    <Section area="upcoming" title="Upcoming" count={board.upcoming.length}>
      {board.upcoming.length === 0 ? (
        <p className="chores-page-note">Nothing is coming up.</p>
      ) : (
        <ul className="chores-page-list">
          {board.upcoming.map((chore) => (
            <li key={chore.id} className="chores-page-row" data-static="">
              <Detail name={chore.name}>
                <time dateTime={chore.nextDue}>{nextDueText(chore.nextDue, board.today)}</time>
              </Detail>
              <span className="chores-page-points">{pointsText(chore.points)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Recent({ board }: { board: BoardResponse }) {
  const people = new Map(board.people.map((person) => [person.id, person]));
  return (
    <Section area="recent" title="Recent" count={board.completions.length}>
      {board.completions.length === 0 ? (
        <p className="chores-page-note">Nothing done yet this week.</p>
      ) : (
        <ul className="chores-page-list">
          {board.completions.map((completion) => {
            const person = people.get(completion.personId);
            return (
              <li key={completion.id} className="chores-page-row" data-static="">
                {person !== undefined && <PersonAvatar person={person} />}
                <Detail name={completion.choreName}>
                  {person?.displayName ?? 'Someone'} ·{' '}
                  <time dateTime={new Date(completion.completedAt).toISOString()}>
                    {completedText(completion.completedAt, board.today, zone)}
                  </time>
                </Detail>
                <span className="chores-page-points">+{pointsText(completion.pointsAwarded)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
