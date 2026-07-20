import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import { DADAKIDO_WORLD_POSITION, EXHIBITION_CREATURE_ORBIT } from './cosmicAnchors';
import { useAutoCosmicInteractionStore } from './autoCosmicInteractionStore';
import { compareEvolutionRank } from './creatureEvolutionMath';
import { useCreatureEvolutionStore } from './creatureEvolutionStore';
import { useCreatureInteractionStore } from './creatureInteractionStore';
import { getSortedGalaxyPortals } from './galaxyPortalRegistry';
import { choosePortalExit } from './galaxyPortalRouting';
import {
  isCreatureActivityActive,
  isInitialCreatureAdmissionSettled
} from './creatureActivity';
import { getPlanetWorldPosition, PLANETS } from './OrbitalPlanets';

const COLLAPSE_MIN_DELAY = 7;
const COLLAPSE_MAX_DELAY = 11;
const EVENT_MIN_DELAY = 4;
const EVENT_MAX_DELAY = 7;
const DUST_FEED_INTERVAL = 0.65;
const PORTAL_ENTRY_DURATION = 0.58;
const PORTAL_EMERGE_DURATION = 1.8;
const PORTAL_RETURN_DURATION = 4.8;
const PORTAL_EVENT_DURATION = PORTAL_ENTRY_DURATION
  + PORTAL_EMERGE_DURATION
  + PORTAL_RETURN_DURATION;
const FIGHT_SCAN_INTERVAL = 0.45;
const FIGHT_DISTANCE = 1.68;
const FIGHT_DURATION = 3.8;
const FIGHT_SCENE_GAP = 2.1;
const FIGHT_CREATURE_COOLDOWN = 10;
const PLANET_SCAN_INTERVAL = 0.62;
const PLANET_CAPTURE_DURATION = 1.7;
const PLANET_HOLD_DURATION = 0.9;
const PLANET_RETURN_DURATION = 2.8;
const PLANET_EVENT_DURATION = PLANET_CAPTURE_DURATION
  + PLANET_HOLD_DURATION
  + PLANET_RETURN_DURATION;
const PLANET_SCENE_GAP = 2.8;
const PLANET_CREATURE_COOLDOWN = 14;

function populationSlowdown(creatureCount: number) {
  return 1 + Math.max(0, creatureCount - 8) * 0.09;
}

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
    nextAt: randomDelay(4, 7)
  });
  const eventRef = useRef({
    nextAt: randomDelay(4, 7),
    nextCleanupAt: 0,
    step: 0
  });
  const encountersRef = useRef({
    nextFightScanAt: 3,
    nextPlanetScanAt: 4,
    nextPortalScanAt: 2,
    nextDustFeedAt: 1.2,
    nextCooldownCleanupAt: 30,
    nextFightAllowedAt: 0,
    nextPlanetAllowedAt: 0,
    fightCooldowns: new Map<string, number>(),
    planetCooldowns: new Map<string, number>(),
    portalCooldowns: new Map<string, number>(),
    pendingEvolutionPenalties: new Map<string, {
      sequence: number;
      applyAt: number;
      kind: 'defeat' | 'planet' | 'portal';
    }>()
  });
  const planetScratchRef = useRef(new THREE.Vector3());
  const firstScratchRef = useRef(new THREE.Vector3());
  const secondScratchRef = useRef(new THREE.Vector3());
  const legacyInteractionsClearedRef = useRef(false);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const wallTime = performance.now() * 0.001;
    const sketch = useSketchStore.getState();
    const artwork = useArtworkStore.getState();
    const behavior = useCreatureBehaviorStore.getState();
    const auto = useAutoCosmicInteractionStore.getState();
    const interactions = useCreatureInteractionStore.getState();
    const evolution = useCreatureEvolutionStore.getState();
    const encounter = encountersRef.current;
    const spotlight = sketch.spotlight;
    const hasSpotlightLifecycle = Boolean(
      spotlight.creatureId || spotlight.requestedCreatureId || spotlight.pendingCreatureId
    );
    const isSpotlightProtected = (creatureId: string) => creatureId === spotlight.creatureId
      || creatureId === spotlight.requestedCreatureId
      || creatureId === spotlight.pendingCreatureId;

    if (!legacyInteractionsClearedRef.current) {
      evolution.replaceIntents({});
      behavior.setPointerWorld(null);
      for (const creatureId of Object.keys(interactions.portalApproaches)) {
        interactions.clearPortalApproach(creatureId);
      }
      for (const [creatureId, event] of Object.entries(interactions.events)) {
        if (event.kind !== 'portal') interactions.clearEvent(creatureId, event.sequence);
      }
      legacyInteractionsClearedRef.current = true;
    }

    if (hasSpotlightLifecycle) {
      for (const protectedId of [
        spotlight.creatureId,
        spotlight.requestedCreatureId,
        spotlight.pendingCreatureId
      ]) {
        if (!protectedId) continue;
        interactions.clearEvent(protectedId);
        evolution.clearIntent(protectedId);
      }
      if (sketch.collapse.active) sketch.endCollapse();
      collapseRef.current.active = false;
      collapseRef.current.nextAt = now + randomDelay(COLLAPSE_MIN_DELAY, COLLAPSE_MAX_DELAY);
    } else if (collapseRef.current.active) {
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

    const mountedPositions = behavior.creaturePositions;
    const isMountedArtwork = (creatureId: string) => isInitialCreatureAdmissionSettled()
      && isCreatureActivityActive(creatureId)
      && Boolean(mountedPositions[creatureId])
      && artwork.artworks.some((entry) => entry.id === creatureId);

    if (now >= eventRef.current.nextCleanupAt) {
      eventRef.current.nextCleanupAt = now + 0.15;
      for (const [creatureId, penalty] of encounter.pendingEvolutionPenalties) {
        if (now < penalty.applyAt) continue;
        const event = useCreatureInteractionStore.getState().events[creatureId];
        if (event?.sequence === penalty.sequence) {
          if (penalty.kind === 'defeat') {
            evolution.recordDefeat(creatureId);
            auto.triggerCreatureBurst(creatureId);
          } else if (penalty.kind === 'planet') {
            evolution.recordPlanetTrap(creatureId);
            auto.triggerCreatureBurst(creatureId);
          } else {
            evolution.recordLevelLoss(creatureId);
          }
        }
        encounter.pendingEvolutionPenalties.delete(creatureId);
      }
      const eventsForCleanup = useCreatureInteractionStore.getState().events;
      for (const creatureId in eventsForCleanup) {
        const event = eventsForCleanup[creatureId];
        if (now >= event.startedAt + event.duration) {
          interactions.clearEvent(creatureId, event.sequence);
        }
      }
    }

    if (now >= encounter.nextCooldownCleanupAt) {
      encounter.nextCooldownCleanupAt = now + 30;
      for (const cooldowns of [
        encounter.fightCooldowns,
        encounter.planetCooldowns,
        encounter.portalCooldowns
      ]) {
        for (const [creatureId, expiresAt] of cooldowns) {
          if (expiresAt <= now || !mountedPositions[creatureId]) cooldowns.delete(creatureId);
        }
      }
    }

    let currentEvents = useCreatureInteractionStore.getState().events;

    if (now >= encounter.nextPlanetScanAt) {
      encounter.nextPlanetScanAt = now + PLANET_SCAN_INTERVAL
        * populationSlowdown(Object.keys(mountedPositions).length);
      const hasActiveDramaticInteraction = Object.values(currentEvents)
        .some((event) => (
          (event.kind === 'trapped' || event.kind === 'fight')
          && now < event.startedAt + event.duration
        ));
      if (!hasActiveDramaticInteraction && now >= encounter.nextPlanetAllowedAt) {
        const mountedIds = Object.keys(mountedPositions);
        const creatureStart = mountedIds.length > 0
          ? Math.floor(Math.random() * mountedIds.length)
          : 0;
        let captured = false;
        for (let offset = 0; offset < mountedIds.length && !captured; offset += 1) {
          const creatureId = mountedIds[(creatureStart + offset) % mountedIds.length];
          if (!isMountedArtwork(creatureId) || isSpotlightProtected(creatureId)) continue;
          if (currentEvents[creatureId] || (behavior.featuredUntil[creatureId] ?? 0) > wallTime) continue;
          if ((encounter.planetCooldowns.get(creatureId) ?? 0) > now) continue;
          const creaturePosition = firstScratchRef.current.set(...mountedPositions[creatureId]);
          const planetStart = Math.floor(Math.random() * PLANETS.length);
          for (let planetOffset = 0; planetOffset < PLANETS.length; planetOffset += 1) {
            const planetIndex = (planetStart + planetOffset) % PLANETS.length;
            const planet = PLANETS[planetIndex];
            const planetPosition = getPlanetWorldPosition(planetIndex, now, planetScratchRef.current);
            const captureRadius = planet.planetRadius + 0.88;
            if (creaturePosition.distanceToSquared(planetPosition) > captureRadius * captureRadius) continue;
            const trappedEvent = interactions.triggerEvent(creatureId, {
              kind: 'trapped',
              startedAt: now,
              duration: PLANET_EVENT_DURATION,
              planetIndex,
              anchor: planetPosition.toArray(),
              origin: creaturePosition.toArray(),
              captureDuration: PLANET_CAPTURE_DURATION
            });
            encounter.pendingEvolutionPenalties.set(creatureId, {
              sequence: trappedEvent.sequence,
              applyAt: now + PLANET_CAPTURE_DURATION,
              kind: 'planet'
            });
            auto.triggerPlanetPulse(planetIndex);
            encounter.planetCooldowns.set(creatureId, now + PLANET_CREATURE_COOLDOWN);
            encounter.nextPlanetAllowedAt = now + PLANET_EVENT_DURATION + PLANET_SCENE_GAP;
            captured = true;
            break;
          }
        }
      }
      currentEvents = useCreatureInteractionStore.getState().events;
    }

    if (now >= encounter.nextFightScanAt) {
      encounter.nextFightScanAt = now + FIGHT_SCAN_INTERVAL
        * populationSlowdown(Object.keys(mountedPositions).length);
      const hasActiveDramaticInteraction = Object.values(currentEvents)
        .some((event) => (
          (event.kind === 'fight' || event.kind === 'trapped')
          && now < event.startedAt + event.duration
        ));
      if (!hasActiveDramaticInteraction && now >= encounter.nextFightAllowedAt) {
        const eligibleIds = Object.keys(mountedPositions).filter((creatureId) => (
          isMountedArtwork(creatureId)
          && !isSpotlightProtected(creatureId)
          && !currentEvents[creatureId]
          && (behavior.featuredUntil[creatureId] ?? 0) <= wallTime
          && (encounter.fightCooldowns.get(creatureId) ?? 0) <= now
        ));
        const startIndex = eligibleIds.length > 0
          ? Math.floor(Math.random() * eligibleIds.length)
          : 0;
        let fightStarted = false;
        for (let firstOffset = 0; firstOffset < eligibleIds.length - 1 && !fightStarted; firstOffset += 1) {
          const firstId = eligibleIds[(startIndex + firstOffset) % eligibleIds.length];
          const firstPosition = firstScratchRef.current.set(...mountedPositions[firstId]);
          for (let secondOffset = firstOffset + 1; secondOffset < eligibleIds.length; secondOffset += 1) {
            const secondId = eligibleIds[(startIndex + secondOffset) % eligibleIds.length];
            const secondPosition = secondScratchRef.current.set(...mountedPositions[secondId]);
            if (firstPosition.distanceToSquared(secondPosition) > FIGHT_DISTANCE * FIGHT_DISTANCE) continue;
            const anchor = firstPosition.clone().lerp(secondPosition, 0.5).toArray();
            const firstFightEvent = interactions.triggerEvent(firstId, {
              kind: 'fight',
              startedAt: now,
              duration: FIGHT_DURATION,
              targetId: secondId,
              role: 'left',
              anchor,
              origin: firstPosition.toArray()
            });
            const secondFightEvent = interactions.triggerEvent(secondId, {
              kind: 'fight',
              startedAt: now,
              duration: FIGHT_DURATION,
              targetId: firstId,
              role: 'right',
              anchor,
              origin: secondPosition.toArray()
            });
            const firstRecord = evolution.records[firstId];
            const secondRecord = evolution.records[secondId];
            const rankDifference = compareEvolutionRank(firstRecord, secondRecord);
            const loserId = rankDifference > 0
              ? secondId
              : rankDifference < 0
                ? firstId
                : (Math.random() < 0.5 ? firstId : secondId);
            encounter.pendingEvolutionPenalties.set(loserId, {
              sequence: loserId === firstId ? firstFightEvent.sequence : secondFightEvent.sequence,
              applyAt: now + FIGHT_DURATION,
              kind: 'defeat'
            });
            encounter.fightCooldowns.set(firstId, now + FIGHT_CREATURE_COOLDOWN);
            encounter.fightCooldowns.set(secondId, now + FIGHT_CREATURE_COOLDOWN);
            encounter.nextFightAllowedAt = now + FIGHT_DURATION + FIGHT_SCENE_GAP;
            fightStarted = true;
            break;
          }
        }
      }
      currentEvents = useCreatureInteractionStore.getState().events;
    }

    if (now >= encounter.nextPortalScanAt) {
      encounter.nextPortalScanAt = now + 0.35 * populationSlowdown(Object.keys(mountedPositions).length);
      const portals = getSortedGalaxyPortals();
      if (portals.length >= 2) {
        for (const creatureId of Object.keys(mountedPositions)) {
          if (!isMountedArtwork(creatureId) || isSpotlightProtected(creatureId)) continue;
          if (currentEvents[creatureId] || (behavior.featuredUntil[creatureId] ?? 0) > wallTime) continue;
          if ((encounter.portalCooldowns.get(creatureId) ?? 0) > now) continue;
          const creaturePosition = firstScratchRef.current.set(...mountedPositions[creatureId]);
          const entryPortal = portals.find((portal) => (
            creaturePosition.distanceToSquared(portal.position)
              <= portal.captureRadius * portal.captureRadius
          ));
          if (!entryPortal) continue;
          const nextSequence = useCreatureInteractionStore.getState().sequence + 1;
          const exitId = choosePortalExit(
            entryPortal.id,
            portals.map((portal) => portal.id),
            creatureId,
            nextSequence
          );
          const exitPortal = portals.find((portal) => portal.id === exitId);
          if (!exitPortal) continue;
          const portalEvent = interactions.triggerEvent(creatureId, {
            kind: 'portal',
            startedAt: now,
            duration: PORTAL_EVENT_DURATION,
            origin: creaturePosition.toArray(),
            portal: {
              entryId: entryPortal.id,
              exitId: exitPortal.id,
              entryPosition: entryPortal.position.toArray(),
              exitPosition: exitPortal.position.toArray(),
              entryRadius: entryPortal.apertureRadius,
              exitRadius: exitPortal.apertureRadius,
              entryVisualRadius: entryPortal.visualRadius,
              exitVisualRadius: exitPortal.visualRadius,
              entryNormal: entryPortal.normal.toArray(),
              exitNormal: exitPortal.normal.toArray(),
              transitionAt: PORTAL_ENTRY_DURATION
            }
          });
          encounter.pendingEvolutionPenalties.set(creatureId, {
            sequence: portalEvent.sequence,
            applyAt: now + PORTAL_ENTRY_DURATION + PORTAL_EMERGE_DURATION,
            kind: 'portal'
          });
          encounter.portalCooldowns.set(creatureId, now + PORTAL_EVENT_DURATION + 14);
          currentEvents = useCreatureInteractionStore.getState().events;
          break;
        }
      }
    }

    if (now >= encounter.nextDustFeedAt) {
      encounter.nextDustFeedAt = now + DUST_FEED_INTERVAL;
      const artworkIndexById = new Map(artwork.artworks.map((entry, index) => [entry.id, index]));
      const mountedIds = Object.keys(mountedPositions);
      const indexedCreatures: Array<{ id: string; index: number }> = [];
      const dustUpdates: Array<{ id: string; amount: number }> = [];
      for (const creatureId of mountedIds) {
        if (!isInitialCreatureAdmissionSettled() || !isCreatureActivityActive(creatureId)) continue;
        const artworkIndex = artworkIndexById.get(creatureId) ?? -1;
        if (artworkIndex < 0) continue;
        indexedCreatures.push({ id: creatureId, index: artworkIndex });
        if (isSpotlightProtected(creatureId) || currentEvents[creatureId]) continue;
        const position = mountedPositions[creatureId];
        const density = Math.sin(
          position[0] * 0.37
          + position[1] * 0.29
          + position[2] * 0.21
          + now * 0.18
        ) * 0.5 + 0.5;
        dustUpdates.push({ id: creatureId, amount: 2.4 + density * 1.8 });
      }
      evolution.ensureCreatures(indexedCreatures);
      evolution.addDustExperienceBatch(dustUpdates);
    }

    if (now < eventRef.current.nextAt) return;

    const mountedIds = Object.keys(mountedPositions);
    const step = eventRef.current.step % 4;
    eventRef.current.step += 1;
    eventRef.current.nextAt = now + randomDelay(EVENT_MIN_DELAY, EVENT_MAX_DELAY)
      * populationSlowdown(mountedIds.length);

    if (step <= 1) {
      behavior.addStarFood(randomWorldPoint());
      return;
    }

    auto.triggerNebulaPulse(Math.floor(Math.random() * 3));
  });

  return null;
}
