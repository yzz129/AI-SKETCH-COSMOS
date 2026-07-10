import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
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
  const starfieldRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!starfieldRef.current) return;
    const time = clock.elapsedTime;
    starfieldRef.current.rotation.y = time * 0.0028;
    starfieldRef.current.rotation.x = Math.sin(time * 0.022) * 0.012;
    starfieldRef.current.rotation.z = time * 0.0016;
  });

  return (
    <>
      <group ref={starfieldRef}>
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
      </group>

      {/* Phase 4 — idle or 2500ms: dadakido + planets */}
      <DeferredMount timeout={2500}>
        <NebulaRibbons />
      </DeferredMount>
      <DeferredMount timeout={2800}>
        <OrbitalPlanets />
      </DeferredMount>

    </>
  );
}
