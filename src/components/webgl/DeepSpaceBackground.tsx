import { DeferredMount } from './DeferredMount';
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
  return (
    <>
      <group>
      {/* Phase 0 — instant: gradient sky + lightweight foreground dust */}
      <GradientSky />

      {/* Phase 1 — idle or 200ms: 8K deep stars */}
      <DeferredMount timeout={200}>
        <DeepStarField />
      </DeferredMount>

      {/* Phase 2 — idle or 600ms: twinkling stars + galaxies */}
      <DeferredMount timeout={600}>
        <TwinkleStars />
      </DeferredMount>
      <DeferredMount timeout={800}>
        <GalaxyBand />
      </DeferredMount>

      {/* Phase 3 — idle or 1500ms: nebula layers */}
      <DeferredMount timeout={1500}>
        <NebulaLayer />
      </DeferredMount>

      <DeferredMount timeout={3000}>
        <ForegroundBokehDust />
      </DeferredMount>

      <ForegroundDust />

      {/* Phase 4 — idle or 2800ms: orbiting planets */}
      <DeferredMount timeout={2800}>
        <OrbitalPlanets />
      </DeferredMount>
      </group>

      {/* Dadakido stays independent and always faces front. */}
      <DeferredMount timeout={2500}>
        <NebulaRibbons />
      </DeferredMount>
    </>
  );
}
