import { followLink } from '../../../client/router.js';
import { useClaimFlow } from '../components/useClaimFlow.client.js';
import { lateness, pointsText } from '../components/boardText.js';
import type { WaitingChoreWire } from '../types.js';
import { useBoard } from '../useBoard.client.js';
import '../choresToday.css';

/** Rows the tile shows before "+N more" (the Chores page is uncapped). */
const TILE_ROWS = 5;

/**
 * The wide Home tile: the pool, overdue first then due today, capped with a
 * "+N more" link to the Chores page. Tapping a row starts the claim flow.
 */
export function ChoresToday() {
  const { data, error, refetch } = useBoard();
  const claim = useClaimFlow(data?.people ?? [], refetch);

  const shown = data?.waiting.slice(0, TILE_ROWS) ?? [];
  const more = (data?.waiting.length ?? 0) - shown.length;

  return (
    <section className="chores-today" aria-labelledby="chores-today-heading">
      <h2 id="chores-today-heading" className="chores-today-heading">
        Chores today
      </h2>
      {data === undefined ? (
        <p className="chores-today-note">{error === undefined ? 'Loading…' : 'The chores could not be loaded.'}</p>
      ) : data.waiting.length === 0 ? (
        <p className="chores-today-note">Nothing is waiting. Every chore is done for now.</p>
      ) : (
        <ul className="chores-today-list">
          {shown.map((chore) => (
            <li key={chore.id}>
              <PoolRow
                chore={chore}
                onClaim={() => {
                  claim.start(chore);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <a className="link-button chores-today-more" href="/chores" onClick={followLink}>
          +{more} more
        </a>
      )}
      {claim.ui}
    </section>
  );
}

function PoolRow({ chore, onClaim }: { chore: WaitingChoreWire; onClaim: () => void }) {
  const late = lateness(chore);
  return (
    <button
      type="button"
      className="chores-today-row"
      data-overdue={chore.state === 'overdue' ? '' : undefined}
      onClick={onClaim}
    >
      <span className="chores-today-name">{chore.name}</span>
      {late !== undefined && <span className="chores-today-late">{late}</span>}
      <span className="chores-today-points">{pointsText(chore.points)}</span>
    </button>
  );
}
