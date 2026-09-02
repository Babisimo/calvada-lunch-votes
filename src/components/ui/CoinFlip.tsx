import { useEffect, useRef, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { cn } from './styles';

/**
 * Replays a coin flip that has ALREADY been decided.
 *
 * The admin's browser flipped the coin and wrote the result; this only performs
 * it. Nothing here is random and nothing here is written — if this component
 * never ran, the winner would be exactly the same. That separation is the whole
 * reason the flip is safe: `firestore.rules` allows one winner write per voting
 * window, so the outcome cannot be a thing each visitor computes for themselves.
 *
 * The coin carries the Calvada mark rather than the dish names — "Chicken Katsu
 * Curry" does not fit on a 92px disc, and the reveal reads better underneath it
 * anyway. It is also the one round thing in a deliberately square app, which a
 * coin has earned.
 */
export default function CoinFlip({
  tiedBetween,
  winner,
  onDone,
}: {
  tiedBetween: string[];
  winner: string;
  onDone: () => void;
}) {
  const [landed, setLanded] = useState(false);

  // Keep in step with the coin-toss / coin-spin keyframes in index.css.
  const SPIN_MS = 2200;
  const REVEAL_MS = 900;

  // onDone is held in a ref so its identity CANNOT restart the sequence.
  //
  // It used to be an effect dependency, and both call sites pass an inline
  // arrow. Leaderboard re-renders every second from its countdown tick, so the
  // effect tore down and rebuilt its timers once a second: the coin never
  // landed, the winner was never revealed, and onDone never fired. The timers
  // must run exactly once, from mount.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const land = setTimeout(() => setLanded(true), SPIN_MS);
    const done = setTimeout(() => onDoneRef.current(), SPIN_MS + REVEAL_MS);
    return () => {
      clearTimeout(land);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const others = tiedBetween.filter((name) => name !== winner);

  return (
    <section
      className="mt-6 flex flex-col items-center gap-4 border-t border-border pt-6"
      // One live region for the whole sequence. Screen readers get the outcome
      // announced once it lands rather than a spinning coin they cannot see.
      aria-live="polite"
    >
      <p className="ticket-meta text-[0.625rem] text-ink-muted">
        TIE — {tiedBetween.length} WAY · COIN FLIP
      </p>

      <div className="coin-stage">
        <div className="coin-toss">
          <div className="coin-spin">
            <span className="coin-face">
              <UtensilsCrossed size={30} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="coin-face coin-face-back ticket-control text-xs">Tie</span>
          </div>
        </div>
      </div>

      <div className={cn('text-center transition-opacity duration-300', landed ? 'opacity-100' : 'opacity-0')}>
        <p className="ticket-title text-xl text-stamp-700">{winner}</p>
        {others.length > 0 && (
          <p className="mt-1.5 text-sm text-ink-muted">
            over {others.length === 1 ? others[0] : `${others.length} others`}
          </p>
        )}
      </div>
    </section>
  );
}
