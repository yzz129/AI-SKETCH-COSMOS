import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import { DADAKIDO_WORLD_POSITION, EXHIBITION_CREATURE_ORBIT } from './cosmicAnchors';
import { useAutoCosmicInteractionStore } from './autoCosmicInteractionStore';

const COLLAPSE_MIN_DELAY = 16;
const COLLAPSE_MAX_DELAY = 26;
const EVENT_MIN_DELAY = 10;
const EVENT_MAX_DELAY = 17;

function randomDelay(min: number, max: number) {
  return THREE.MathUtils.randFloat(min, max);
}

function randomCollapseCenter(): [number, number] {
  return [
    THREE.MathUtils.randFloat(0.24, 0.76),
    THREE.MathUtils.randFloat(0.22, 0.72)
  ];
}

function randomWorldPoint(): [number, number, number] {
  return [
    THREE.MathUtils.randFloat(-EXHIBITION_CREATURE_ORBIT.radiusX * 0.72, EXHIBITION_CREATURE_ORBIT.radiusX * 0.72),
    THREE.MathUtils.randFloat(-EXHIBITION_CREATURE_ORBIT.radiusY * 0.78, EXHIBITION_CREATURE_ORBIT.radiusY * 0.9),
    DADAKIDO_WORLD_POSITION[2] + THREE.MathUtils.randFloat(
      -EXHIBITION_CREATURE_ORBIT.radiusZ * 0.82,
      EXHIBITION_CREATURE_ORBIT.radiusZ * 0.82
    )
  ];
}

export function AutoCosmicInteractions() {
  const collapseRef = useRef({
    active: false,
    startedAt: 0,
    startCenter: [0.5, 0.5] as [number, number],
    endCenter: [0.5, 0.5] as [number, number],
    duration: 0,
    storeStartedAt: 0,
    nextAt: randomDelay(7, 12)
  });
  const pointerRef = useRef({
    active: false,
    startedAt: 0,
    start: randomWorldPoint(),
    end: randomWorldPoint(),
    duration: 0,
    nextAt: randomDelay(8, 13)
  });
  const eventRef = useRef({
    nextAt: randomDelay(9, 14),
    step: 0
  });

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const sketch = useSketchStore.getState();
    const artwork = useArtworkStore.getState();
    const behavior = useCreatureBehaviorStore.getState();
    const auto = useAutoCosmicInteractionStore.getState();

    if (collapseRef.current.active) {
      const collapse = useSketchStore.getState().collapse;
      if (!collapse.active || collapse.startedAt !== collapseRef.current.storeStartedAt) {
        collapseRef.current.active = false;
        collapseRef.current.nextAt = now + randomDelay(COLLAPSE_MIN_DELAY, COLLAPSE_MAX_DELAY);
      } else {
        const progress = THREE.MathUtils.smoothstep(
          THREE.MathUtils.clamp((now - collapseRef.current.startedAt) / collapseRef.current.duration, 0, 1),
          0,
          1
        );
        const center: [number, number] = [
          THREE.MathUtils.lerp(collapseRef.current.startCenter[0], collapseRef.current.endCenter[0], progress),
          THREE.MathUtils.lerp(collapseRef.current.startCenter[1], collapseRef.current.endCenter[1], progress)
        ];
        sketch.updateCollapseCenter(center);

        if (progress >= 1) {
          sketch.endCollapse();
          collapseRef.current.active = false;
          collapseRef.current.nextAt = now + randomDelay(COLLAPSE_MIN_DELAY, COLLAPSE_MAX_DELAY);
        }
      }
    } else if (!sketch.collapse.active && now >= collapseRef.current.nextAt) {
      const startCenter = randomCollapseCenter();
      const endCenter = randomCollapseCenter();
      sketch.beginCollapse(startCenter);
      collapseRef.current = {
        active: true,
        startedAt: now,
        startCenter,
        endCenter,
        duration: THREE.MathUtils.randFloat(1.6, 2.8),
        storeStartedAt: useSketchStore.getState().collapse.startedAt,
        nextAt: Number.POSITIVE_INFINITY
      };
    } else if (sketch.collapse.active) {
      collapseRef.current.nextAt = now + randomDelay(COLLAPSE_MIN_DELAY, COLLAPSE_MAX_DELAY);
    }

    if (pointerRef.current.active) {
      const progress = THREE.MathUtils.smoothstep(
        THREE.MathUtils.clamp((now - pointerRef.current.startedAt) / pointerRef.current.duration, 0, 1),
        0,
        1
      );
      behavior.setPointerWorld([
        THREE.MathUtils.lerp(pointerRef.current.start[0], pointerRef.current.end[0], progress),
        THREE.MathUtils.lerp(pointerRef.current.start[1], pointerRef.current.end[1], progress),
        THREE.MathUtils.lerp(pointerRef.current.start[2], pointerRef.current.end[2], progress)
      ]);

      if (progress >= 1) {
        behavior.setPointerWorld(null);
        pointerRef.current.active = false;
        pointerRef.current.nextAt = now + randomDelay(13, 22);
      }
    } else if (!behavior.pointerWorld && now >= pointerRef.current.nextAt) {
      pointerRef.current = {
        active: true,
        startedAt: now,
        start: randomWorldPoint(),
        end: randomWorldPoint(),
        duration: THREE.MathUtils.randFloat(2.2, 4.2),
        nextAt: Number.POSITIVE_INFINITY
      };
    } else if (behavior.pointerWorld) {
      pointerRef.current.nextAt = now + randomDelay(13, 22);
    }

    if (now < eventRef.current.nextAt) return;

    const visibleCreatures = artwork.artworks.slice(0, 50);
    const step = eventRef.current.step % 4;
    eventRef.current.step += 1;
    eventRef.current.nextAt = now + randomDelay(EVENT_MIN_DELAY, EVENT_MAX_DELAY);

    if (step === 0) {
      behavior.addStarFood(randomWorldPoint());
      return;
    }

    if (step === 1) {
      auto.triggerPlanetPulse();
      return;
    }

    if (step === 2) {
      auto.triggerNebulaPulse(Math.floor(Math.random() * 3));
      return;
    }

    if (visibleCreatures.length === 0) {
      behavior.addStarFood(randomWorldPoint());
      return;
    }

    const creature = visibleCreatures[Math.floor(Math.random() * visibleCreatures.length)];
    auto.triggerCreatureBurst(creature.id);
  });

  return null;
}
