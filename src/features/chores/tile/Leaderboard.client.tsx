import { PersonAvatar } from '../../../client/PersonAvatar.js';
import type { PersonWire } from '../../../core/person.js';
import { pointsText } from '../components/boardText.js';
import type { StandingWire } from '../types.js';
import { useBoard } from '../useBoard.client.js';
import '../leaderboard.css';

/**
 * The small Home tile: this week's standings from the board (GLOSSARY:
 * Leaderboard), everyone listed, people on zero too, equal points sharing
 * a rank. The board is the source of order and rank; the tile only joins
 * each standing to its person. It refetches with every other board reader
 * (useBoard), so a claim anywhere and Monday 00:00 both show here.
 */
export function Leaderboard() {
  const { data, error } = useBoard();

  return (
    <section className="leaderboard" aria-labelledby="leaderboard-heading">
      <h2 id="leaderboard-heading" className="leaderboard-heading">
        Leaderboard
      </h2>
      {data === undefined ? (
        <p className="leaderboard-note">{error === undefined ? 'Loading…' : 'The leaderboard could not be loaded.'}</p>
      ) : data.standings.length === 0 ? (
        <p className="leaderboard-note">No one is on the board yet. Add people in Admin.</p>
      ) : (
        <>
          <p className="leaderboard-note">This week</p>
          <ol className="leaderboard-list">
            {data.standings.map((standing) => {
              const person = data.people.find((p) => p.id === standing.personId);
              return person === undefined ? null : (
                <li key={standing.personId}>
                  <StandingRow standing={standing} person={person} />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function StandingRow({ standing, person }: { standing: StandingWire; person: PersonWire }) {
  return (
    <div className="leaderboard-row" data-leading={standing.rank === 1 && standing.points > 0 ? '' : undefined}>
      <span className="leaderboard-rank">{standing.rank}</span>
      <PersonAvatar person={person} />
      <span className="leaderboard-name">{person.displayName}</span>
      <span className="leaderboard-points">{pointsText(standing.points)}</span>
    </div>
  );
}
