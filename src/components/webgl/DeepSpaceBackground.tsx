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

      {/* Phase 4 — idle or 2500ms: dadakido + planets */}
      <DeferredMount timeout={2500}>
        <NebulaRibbons />
      </DeferredMount>
      <DeferredMount timeout={2800}>
        <OrbitalPlanets />
      </DeferredMount>

      {/* Phase 5 — idle or 3000ms: foreground effects */}
      <DeferredMount timeout={3000}>
        <ForegroundBokehDust />
      </DeferredMount>

      {/* Always immediate: subtle foreground dust (72 particles, very lightweight) */}
      <ForegroundDust />
    </>
  );
}
