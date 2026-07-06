import { useEffect } from 'react';
import { useSketchStore } from '../../stores/useSketchStore';
import {
  SPOTLIGHT_FLY_IN_DURATION,
  SPOTLIGHT_SHOWCASE_DURATION,
  SPOTLIGHT_TOTAL_DURATION
} from './spotlightConfig';

/**
 * Purely logical component — manages spotlight phase transitions based on elapsed time.
 * Renders nothing visually.
 */
export function SpotlightDirector() {
  const spotlight = useSketchStore((s) => s.spotlight);
  const advanceSpotlight = useSketchStore((s) => s.advanceSpotlight);
  const endSpotlight = useSketchStore((s) => s.endSpotlight);

  useEffect(() => {
    if (spotlight.phase === 'idle' || !spotlight.creatureId) return;

    const startedAt = spotlight.startedAt;
    let flyInTimer: ReturnType<typeof setTimeout>;
    let releaseTimer: ReturnType<typeof setTimeout>;
    let endTimer: ReturnType<typeof setTimeout>;

    // fly-in → showcase after 2s
    if (spotlight.phase === 'fly-in') {
      const remaining = SPOTLIGHT_FLY_IN_DURATION * 1000 - (Date.now() - startedAt);
      flyInTimer = setTimeout(() => {
        advanceSpotlight('showcase');
      }, Math.max(0, remaining));
    }

    // showcase → release after showcase duration
    if (spotlight.phase === 'fly-in' || spotlight.phase === 'showcase') {
      const delay = spotlight.phase === 'fly-in'
        ? SPOTLIGHT_FLY_IN_DURATION * 1000 + SPOTLIGHT_SHOWCASE_DURATION * 1000 - (Date.now() - startedAt)
        : SPOTLIGHT_SHOWCASE_DURATION * 1000 - (Date.now() - startedAt - SPOTLIGHT_FLY_IN_DURATION * 1000);
      releaseTimer = setTimeout(() => {
        advanceSpotlight('release');
      }, Math.max(0, delay));
    }

    // end spotlight completely
    const totalRemaining = SPOTLIGHT_TOTAL_DURATION * 1000 - (Date.now() - startedAt);
    endTimer = setTimeout(() => {
      endSpotlight();
    }, Math.max(0, totalRemaining));

    return () => {
      clearTimeout(flyInTimer);
      clearTimeout(releaseTimer);
      clearTimeout(endTimer);
    };
  }, [spotlight.creatureId, spotlight.phase, spotlight.startedAt, advanceSpotlight, endSpotlight]);

  return null;
}
