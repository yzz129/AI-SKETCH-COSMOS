import { useEffect, useState } from 'react';
import { BrightSparkStars } from './BrightSparkStars';
import { DarkNebulaClouds } from './DarkNebulaClouds';
import { DeepStarField } from './DeepStarField';
import { ForegroundBokehDust } from './ForegroundBokehDust';
import { ForegroundDust } from './ForegroundDust';
import { GalaxyBand } from './GalaxyBand';
import { GradientSky } from './GradientSky';
import { NebulaLayer } from './NebulaLayer';
import { NebulaRibbons } from './NebulaRibbons';
import { OrbitalPlanets } from './OrbitalPlanets';
import { TwinkleStars } from './TwinkleStars';

export function DeepSpaceBackground() {
  const [loadPhase, setLoadPhase] = useState(0);

  useEffect(() => {
    const schedule = (phase: number, delay: number) => {
      const timeoutId = window.setTimeout(() => {
        const reveal = () => setLoadPhase((current) => Math.max(current, phase));

        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(reveal, { timeout: 700 });
          return;
        }

        window.setTimeout(reveal, 1);
      }, delay);

      return timeoutId;
    };

    const timers = [
      schedule(1, 220),
      schedule(2, 520),
      schedule(3, 900)
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <>
      <GradientSky />
      <DeepStarField />
      <TwinkleStars />
      <GalaxyBand />
      {loadPhase >= 1 && <NebulaLayer />}
      {loadPhase >= 1 && <DarkNebulaClouds />}
      {loadPhase >= 2 && <OrbitalPlanets />}
      {loadPhase >= 2 && <NebulaRibbons />}
      {loadPhase >= 3 && <BrightSparkStars />}
      <ForegroundDust />
      {loadPhase >= 3 && <ForegroundBokehDust />}
    </>
  );
}
