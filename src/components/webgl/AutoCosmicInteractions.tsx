import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useArtworkStore } from '../../stores/artworkStore';
import { useSketchStore } from '../../stores/useSketchStore';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import { DADAKIDO_WORLD_POSITION, EXHIBITION_CREATURE_ORBIT } from './cosmicAnchors';
import { useAutoCosmicInteractionStore } from './autoCosmicInteractionStore';
import {
  canDefeatEvolution,
  combatPowerFor,
  compareEvolutionRank
} from './creatureEvolutionMath';
import {
  type CreatureAiIntent,
  useCreatureEvolutionStore
} from './creatureEvolutionStore';
import { useCreatureInteractionStore } from './creatureInteractionStore';
import { getPlanetWorldPosition, PLANETS } from './OrbitalPlanets';
import { getSortedGalaxyPortals } from './galaxyPortalRegistry';
import { choosePortalExit, isConfirmedChasedPrey } from './galaxyPortalRouting';

const COLLAPSE_MIN_DELAY = 9;
const COLLAPSE_MAX_DELAY = 15;
const EVENT_MIN_DELAY = 5;
const EVENT_MAX_DELAY = 9;
const FIGHT_DISTANCE = 2.35;
const FIGHT_DURATION = 3.2;
const AI_CHASE_RANGE = 12;
const AI_FLEE_RANGE = 9;
const AI_SCAN_INTERVAL = 0.36;
const DUST_FEED_INTERVAL = 0.65;

function stabilizeAiIntent(
  previous: CreatureAiIntent | undefined,
  next: CreatureAiIntent,
  now: number
) {
  if (
    previous
    && previous.mode === next.mode
    && previous.targetId === next.targetId
    && Math.abs(previous.strength - next.strength) < 0.05
    && previous.expiresAt > now + AI_SCAN_INTERVAL * 1.35
  ) return previous;
  return next;
}
const PLANET_SUCTION_DURATION = 2.1;
const PLANET_STRUGGLE_DURATION = 3.6;
const PLANET_PARTICLE_BLEND_DURATION = 0.34;
const PLANET_TRAP_DURATION = PLANET_SUCTION_DURATION
  + PLANET_STRUGGLE_DURATION
  + PLANET_PARTICLE_BLEND_DURATION;

function fightCellKey(position: [number, number, number]) {
  return [
    Math.floor(position[0] / FIGHT_DISTANCE),
    Math.floor(position[1] / FIGHT_DISTANCE),
    Math.floor(position[2] / FIGHT_DISTANCE)
  ].join(':');
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
  const pointerRef = useRef({
    active: false,
    startedAt: 0,
    start: randomWorldPoint(),
    end: randomWorldPoint(),
    duration: 0,
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
    nextAiScanAt: 1,
    nextPortalScanAt: 2,
    nextDustFeedAt: 1.2,
    activeFight: null as null | {
      firstId: string;
      secondId: string;
      winnerId: string;
      loserId: string;
      resolveAt: number;
      clearAt: number;
      resolved: boolean;
      firstSequence: number;
      secondSequence: number;
      winnerSequence?: number;
    },
    traps: new Map<string, {
      planetIndex: number;
      captureAt: number;
      escapeAt: number;
      clearAt: number;
      planetPulseTriggered: boolean;
      escaped: boolean;
      degraded: boolean;
      sequence: number;
    }>(),
    pairCooldowns: new Map<string, number>(),
    creatureCooldowns: new Map<string, number>(),
    portalCooldowns: new Map<string, number>()
  });
  const planetScratchRef = useRef(new THREE.Vector3());
  const firstScratchRef = useRef(new THREE.Vector3());
  const secondScratchRef = useRef(new THREE.Vector3());

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

    if (hasSpotlightLifecycle) {
      for (const protectedId of [
        spotlight.creatureId,
        spotlight.requestedCreatureId,
        spotlight.pendingCreatureId
      ]) {
        if (!protectedId) continue;
        interactions.clearEvent(protectedId);
        evolution.clearIntent(protectedId);
        encounter.traps.delete(protectedId);
      }
      const fight = encounter.activeFight;
      if (fight && (isSpotlightProtected(fight.firstId) || isSpotlightProtected(fight.secondId))) {
        interactions.clearEvent(fight.firstId);
        interactions.clearEvent(fight.secondId);
        encounter.activeFight = null;
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

    if (hasSpotlightLifecycle) {
      if (pointerRef.current.active || behavior.pointerWorld) behavior.setPointerWorld(null);
      pointerRef.current.active = false;
      pointerRef.current.nextAt = now + randomDelay(6, 10);
    } else if (pointerRef.current.active) {
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
        pointerRef.current.nextAt = now + randomDelay(6, 10);
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
      pointerRef.current.nextAt = now + randomDelay(6, 10);
    }

    const mountedPositions = behavior.creaturePositions;
    const isMountedArtwork = (creatureId: string) => Boolean(mountedPositions[creatureId])
      && artwork.artworks.some((entry) => entry.id === creatureId);
    if (encounter.activeFight && (
      !isMountedArtwork(encounter.activeFight.firstId)
      || !isMountedArtwork(encounter.activeFight.secondId)
    )) {
      interactions.clearEvent(encounter.activeFight.firstId);
      interactions.clearEvent(encounter.activeFight.secondId);
      encounter.activeFight = null;
    }
    for (const creatureId of encounter.traps.keys()) {
      if (!isMountedArtwork(creatureId)) {
        interactions.clearEvent(creatureId);
        evolution.clearIntent(creatureId);
        encounter.traps.delete(creatureId);
      }
    }

    const activeFight = encounter.activeFight;
    if (activeFight && !activeFight.resolved && now >= activeFight.resolveAt) {
      const currentRecords = useCreatureEvolutionStore.getState().records;
      const firstRecord = currentRecords[activeFight.firstId];
      const secondRecord = currentRecords[activeFight.secondId];
      const resolvedWinnerId = firstRecord && secondRecord && canDefeatEvolution(firstRecord, secondRecord)
        ? activeFight.firstId
        : firstRecord && secondRecord && canDefeatEvolution(secondRecord, firstRecord)
          ? activeFight.secondId
          : null;
      if (!resolvedWinnerId) {
        interactions.clearEvent(activeFight.firstId, activeFight.firstSequence);
        interactions.clearEvent(activeFight.secondId, activeFight.secondSequence);
        evolution.clearIntent(activeFight.firstId);
        evolution.clearIntent(activeFight.secondId);
        activeFight.resolved = true;
        activeFight.clearAt = now;
      } else {
        activeFight.winnerId = resolvedWinnerId;
        activeFight.loserId = resolvedWinnerId === activeFight.firstId
          ? activeFight.secondId
          : activeFight.firstId;
        interactions.clearEvent(activeFight.loserId);
        auto.triggerCreatureBurst(activeFight.loserId);
        const victory = interactions.triggerEvent(activeFight.winnerId, {
          kind: 'victory',
          startedAt: now,
          duration: 1.8,
          targetId: activeFight.loserId,
          role: 'winner'
        });
        activeFight.winnerSequence = victory.sequence;
        evolution.recordVictory(activeFight.winnerId);
        evolution.recordDefeat(activeFight.loserId);
        evolution.clearIntent(activeFight.winnerId);
        evolution.clearIntent(activeFight.loserId);
        activeFight.resolved = true;
      }
    }
    if (activeFight && now >= activeFight.clearAt) {
      interactions.clearEvent(activeFight.firstId, activeFight.firstId === activeFight.winnerId ? activeFight.winnerSequence : activeFight.firstSequence);
      interactions.clearEvent(activeFight.secondId, activeFight.secondId === activeFight.winnerId ? activeFight.winnerSequence : activeFight.secondSequence);
      encounter.activeFight = null;
    }

    for (const [creatureId, trap] of encounter.traps) {
      if (!trap.planetPulseTriggered && now >= trap.captureAt) {
        // Fire exactly once, after the model has reached the planet centre.
        // The planet owns the reusable particle geometry, so this is only a
        // tiny state signal rather than a new allocation during animation.
        auto.triggerPlanetPulse(trap.planetIndex);
        trap.planetPulseTriggered = true;
      }
      if (!trap.degraded && now >= trap.captureAt) {
        evolution.recordPlanetTrap(creatureId);
        evolution.clearIntent(creatureId);
        trap.degraded = true;
      }
      if (!trap.escaped && now >= trap.escapeAt) {
        // Keep the trapped event alive through the model/particle crossfade.
        // SpaceCreature continues sampling the moving planet, so the model
        // cannot snap back to its normal orbit before it has fully dissolved.
        auto.triggerCreatureBurst(creatureId);
        trap.escaped = true;
      }
      if (now >= trap.clearAt) {
        interactions.clearEvent(creatureId, trap.sequence);
        encounter.traps.delete(creatureId);
      }
    }

    if (now >= eventRef.current.nextCleanupAt) {
      eventRef.current.nextCleanupAt = now + 0.15;
      for (const creatureId in interactions.events) {
        const event = interactions.events[creatureId];
        if ((event.kind === 'boost' || event.kind === 'collision' || event.kind === 'portal') && now >= event.startedAt + event.duration) {
          interactions.clearEvent(creatureId, event.sequence);
        }
      }
    }

    if (now >= encounter.nextPlanetScanAt) {
      encounter.nextPlanetScanAt = now + 0.32;
      const mountedIds = Object.keys(mountedPositions);
      let trappedThisScan = false;
      for (const creatureId of mountedIds) {
        if (isSpotlightProtected(creatureId) || interactions.events[creatureId] || encounter.traps.has(creatureId)) continue;
        if ((behavior.featuredUntil[creatureId] ?? 0) > wallTime) continue;
        if ((encounter.creatureCooldowns.get(creatureId) ?? 0) > now) continue;
        const creaturePosition = firstScratchRef.current.set(...mountedPositions[creatureId]);
        for (let planetIndex = 0; planetIndex < PLANETS.length; planetIndex += 1) {
          const planet = PLANETS[planetIndex];
          const planetPosition = getPlanetWorldPosition(planetIndex, now, planetScratchRef.current);
          // Start pulling while the creature is visibly beside the planet,
          // rather than waiting for the two splat volumes to overlap.
          const captureRadius = planet.planetRadius + 0.9;
          if (creaturePosition.distanceToSquared(planetPosition) > captureRadius * captureRadius) continue;
          const trapped = interactions.triggerEvent(creatureId, {
            kind: 'trapped',
            startedAt: now,
            duration: PLANET_TRAP_DURATION,
            planetIndex,
            anchor: planetPosition.toArray(),
            origin: creaturePosition.toArray(),
            captureDuration: PLANET_SUCTION_DURATION
          });
          encounter.traps.set(creatureId, {
            planetIndex,
            captureAt: now + PLANET_SUCTION_DURATION,
            escapeAt: now + PLANET_SUCTION_DURATION + PLANET_STRUGGLE_DURATION,
            clearAt: now + PLANET_TRAP_DURATION + 1.5,
            planetPulseTriggered: false,
            escaped: false,
            degraded: false,
            sequence: trapped.sequence
          });
          encounter.creatureCooldowns.set(creatureId, now + 13);
          trappedThisScan = true;
          break;
        }
        if (trappedThisScan) break;
      }
    }

    if (now >= encounter.nextPortalScanAt) {
      encounter.nextPortalScanAt = now + 0.08;
      const portals = getSortedGalaxyPortals();
      const intentSnapshot = useCreatureEvolutionStore.getState().intents;
      if (portals.length >= 2) {
        for (const creatureId of Object.keys(mountedPositions)) {
          if (!isMountedArtwork(creatureId) || isSpotlightProtected(creatureId)) continue;
          if (interactions.events[creatureId] || (behavior.featuredUntil[creatureId] ?? 0) > wallTime) continue;
          if ((encounter.portalCooldowns.get(creatureId) ?? 0) > now) continue;
          const existingApproach = interactions.portalApproaches[creatureId];
          if (!existingApproach) {
            if (!isConfirmedChasedPrey(creatureId, intentSnapshot, now)) continue;
            const flee = intentSnapshot[creatureId];
            if (!flee) continue;
            const creaturePosition = firstScratchRef.current.set(...mountedPositions[creatureId]);
            let entryPortal = portals[0];
            let nearestDistanceSq = Number.POSITIVE_INFINITY;
            for (const portal of portals) {
              const distanceSq = creaturePosition.distanceToSquared(portal.position);
              if (distanceSq < nearestDistanceSq) {
                entryPortal = portal;
                nearestDistanceSq = distanceSq;
              }
            }
            const nextSequence = useCreatureInteractionStore.getState().sequence + 1;
            const exitId = choosePortalExit(entryPortal.id, portals.map((portal) => portal.id), creatureId, nextSequence);
            if (!exitId) continue;
            interactions.commitPortalApproach({
              creatureId,
              predatorId: flee.targetId,
              entryId: entryPortal.id,
              exitId,
              committedAt: now,
              intentGraceUntil: now + 0.45
            });
            continue;
          }
          const entryPortal = portals.find((portal) => portal.id === existingApproach.entryId);
          const exitPortal = portals.find((portal) => portal.id === existingApproach.exitId);
          if (!entryPortal || !exitPortal) {
            interactions.clearPortalApproach(creatureId);
            continue;
          }
          const creaturePosition = firstScratchRef.current.set(...mountedPositions[creatureId]);
          if (creaturePosition.distanceToSquared(entryPortal.position) > entryPortal.captureRadius * entryPortal.captureRadius) continue;
          interactions.clearPortalApproach(creatureId);
          interactions.triggerEvent(creatureId, {
            kind: 'portal',
            startedAt: now,
            duration: 2.8,
            targetId: existingApproach.predatorId,
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
              transitionAt: 0.6
            }
          });
          evolution.clearIntent(creatureId);
          evolution.clearIntent(existingApproach.predatorId);
          encounter.portalCooldowns.set(creatureId, now + 8);
          encounter.creatureCooldowns.set(creatureId, now + 8);
          encounter.creatureCooldowns.set(existingApproach.predatorId, now + 4);
          break;
        }
      }
    }

    const needsArtworkIndex = now >= encounter.nextDustFeedAt || now >= encounter.nextAiScanAt;
    const artworkIndexById = needsArtworkIndex
      ? new Map(artwork.artworks.map((entry, index) => [entry.id, index]))
      : null;

    if (now >= encounter.nextDustFeedAt) {
      encounter.nextDustFeedAt = now + DUST_FEED_INTERVAL;
      const mountedIds = Object.keys(mountedPositions);
      const indexedCreatures: Array<{ id: string; index: number }> = [];
      const dustUpdates: Array<{ id: string; amount: number }> = [];
      for (const creatureId of mountedIds) {
        const artworkIndex = artworkIndexById?.get(creatureId) ?? -1;
        if (artworkIndex < 0) continue;
        indexedCreatures.push({ id: creatureId, index: artworkIndex });
        if (isSpotlightProtected(creatureId) || interactions.events[creatureId]) continue;
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

    if (now >= encounter.nextAiScanAt) {
      encounter.nextAiScanAt = now + AI_SCAN_INTERVAL;
      const eligibleIds = Object.keys(mountedPositions).filter((creatureId) => (
        isMountedArtwork(creatureId)
        && !isSpotlightProtected(creatureId)
        && !interactions.events[creatureId]
        && !encounter.traps.has(creatureId)
        && (encounter.creatureCooldowns.get(creatureId) ?? 0) <= now
        && (behavior.featuredUntil[creatureId] ?? 0) <= wallTime
      ));
      evolution.ensureCreatures(eligibleIds.map((creatureId) => ({
        id: creatureId,
        index: Math.max(0, artworkIndexById?.get(creatureId) ?? 0)
      })));
      const evolutionSnapshot = useCreatureEvolutionStore.getState();
      const records = evolutionSnapshot.records;
      const previousIntents = evolutionSnapshot.intents;
      const powerById = new Map(eligibleIds.map((creatureId) => {
        const record = records[creatureId];
        return [creatureId, combatPowerFor(record.index, record.level)] as const;
      }));
      const rankedIds = [...eligibleIds].sort((leftId, rightId) => {
        const evolutionDifference = compareEvolutionRank(records[rightId], records[leftId]);
        return evolutionDifference || (powerById.get(rightId) ?? 0) - (powerById.get(leftId) ?? 0);
      });
      const nextIntents: Record<string, CreatureAiIntent> = {};
      const assignIntent = (creatureId: string, intent: CreatureAiIntent) => {
        nextIntents[creatureId] = stabilizeAiIntent(previousIntents[creatureId], intent, now);
      };

      for (const creatureId of rankedIds) {
        const ownRecord = records[creatureId];
        const ownPower = powerById.get(creatureId) ?? 1;
        const ownPosition = mountedPositions[creatureId];
        let threatId: string | null = null;
        let threatScore = AI_FLEE_RANGE * AI_FLEE_RANGE;
        for (const candidateId of rankedIds) {
          if (candidateId === creatureId) continue;
          if (!canDefeatEvolution(records[candidateId], ownRecord)) continue;
          firstScratchRef.current.set(...ownPosition);
          secondScratchRef.current.set(...mountedPositions[candidateId]);
          const distanceSq = firstScratchRef.current.distanceToSquared(secondScratchRef.current);
          if (distanceSq > AI_FLEE_RANGE * AI_FLEE_RANGE) continue;
          const score = distanceSq * (
            previousIntents[creatureId]?.mode === 'flee'
            && previousIntents[creatureId]?.targetId === candidateId
              ? 0.78
              : 1
          );
          if (score >= threatScore) continue;
          threatScore = score;
          threatId = candidateId;
        }
        if (!threatId) continue;
        const threatPower = powerById.get(threatId) ?? ownPower;
        assignIntent(creatureId, {
          mode: 'flee',
          targetId: threatId,
          strength: THREE.MathUtils.clamp(threatPower / ownPower - 0.35, 0.62, 1.35),
          expiresAt: now + AI_SCAN_INTERVAL * 2.8
        });
      }

      const aggressiveCount = Math.max(1, Math.ceil(rankedIds.length * 0.4));
      for (const predatorId of rankedIds.slice(0, aggressiveCount)) {
        if (nextIntents[predatorId]?.mode === 'flee') continue;
        const predatorRecord = records[predatorId];
        const predatorPower = powerById.get(predatorId) ?? 1;
        const predatorPosition = mountedPositions[predatorId];
        let preyId: string | null = null;
        let preyScore = AI_CHASE_RANGE * AI_CHASE_RANGE;
        for (const candidateId of rankedIds) {
          if (candidateId === predatorId) continue;
          if (!canDefeatEvolution(predatorRecord, records[candidateId])) continue;
          firstScratchRef.current.set(...predatorPosition);
          secondScratchRef.current.set(...mountedPositions[candidateId]);
          const distanceSq = firstScratchRef.current.distanceToSquared(secondScratchRef.current);
          if (distanceSq > AI_CHASE_RANGE * AI_CHASE_RANGE) continue;
          const score = distanceSq * (
            previousIntents[predatorId]?.mode === 'chase'
            && previousIntents[predatorId]?.targetId === candidateId
              ? 0.72
              : 1
          );
          if (score >= preyScore) continue;
          preyScore = score;
          preyId = candidateId;
        }
        if (!preyId) continue;
        const preyPower = powerById.get(preyId) ?? predatorPower;
        assignIntent(predatorId, {
          mode: 'chase',
          targetId: preyId,
          strength: THREE.MathUtils.clamp(predatorPower / preyPower - 0.2, 0.7, 1.4),
          expiresAt: now + AI_SCAN_INTERVAL * 2.8
        });
        assignIntent(preyId, {
          mode: 'flee',
          targetId: predatorId,
          strength: THREE.MathUtils.clamp(predatorPower / preyPower - 0.25, 0.72, 1.45),
          expiresAt: now + AI_SCAN_INTERVAL * 2.8
        });
      }
      evolution.replaceIntents(nextIntents);
    }

    if (!encounter.activeFight && now >= encounter.nextFightScanAt) {
      encounter.nextFightScanAt = now + 0.48;
      const mountedIds = Object.keys(mountedPositions);
      let closest: { firstId: string; secondId: string; distanceSq: number; score: number } | null = null;
      const fightGrid = new Map<string, string[]>();
      const eligibleIds = mountedIds.filter((creatureId) => (
        !isSpotlightProtected(creatureId)
        && (behavior.featuredUntil[creatureId] ?? 0) <= wallTime
        && !interactions.events[creatureId]
        && !encounter.traps.has(creatureId)
        && (encounter.creatureCooldowns.get(creatureId) ?? 0) <= now
      ));
      const fightSnapshot = useCreatureEvolutionStore.getState();
      const fightRecords = fightSnapshot.records;
      const fightIntents = fightSnapshot.intents;
      for (const creatureId of eligibleIds) {
        const key = fightCellKey(mountedPositions[creatureId]);
        const bucket = fightGrid.get(key) ?? [];
        bucket.push(creatureId);
        fightGrid.set(key, bucket);
      }

      for (const firstId of eligibleIds) {
        const firstPosition = mountedPositions[firstId];
        const cellX = Math.floor(firstPosition[0] / FIGHT_DISTANCE);
        const cellY = Math.floor(firstPosition[1] / FIGHT_DISTANCE);
        const cellZ = Math.floor(firstPosition[2] / FIGHT_DISTANCE);
        firstScratchRef.current.set(...firstPosition);
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
              const neighbors = fightGrid.get(`${cellX + offsetX}:${cellY + offsetY}:${cellZ + offsetZ}`) ?? [];
              for (const secondId of neighbors) {
                if (firstId.localeCompare(secondId) >= 0) continue;
                const firstRecord = fightRecords[firstId];
                const secondRecord = fightRecords[secondId];
                if (
                  !firstRecord
                  || !secondRecord
                  || (
                    !canDefeatEvolution(firstRecord, secondRecord)
                    && !canDefeatEvolution(secondRecord, firstRecord)
                  )
                ) continue;
                const pairKey = [firstId, secondId].sort().join('|');
                if ((encounter.pairCooldowns.get(pairKey) ?? 0) > now) continue;
                secondScratchRef.current.set(...mountedPositions[secondId]);
                const distanceSq = firstScratchRef.current.distanceToSquared(secondScratchRef.current);
                const firstIntent = fightIntents[firstId];
                const secondIntent = fightIntents[secondId];
                const predatorPair = (firstIntent?.mode === 'chase' && firstIntent.targetId === secondId)
                  || (secondIntent?.mode === 'chase' && secondIntent.targetId === firstId);
                const score = distanceSq * (predatorPair ? 0.32 : 1);
                if (
                  distanceSq > FIGHT_DISTANCE * FIGHT_DISTANCE
                  || (closest && score >= closest.score)
                ) continue;
                closest = { firstId, secondId, distanceSq, score };
              }
            }
          }
        }
      }

      if (closest) {
        const firstPosition = firstScratchRef.current.set(...mountedPositions[closest.firstId]);
        const secondPosition = secondScratchRef.current.set(...mountedPositions[closest.secondId]);
        const firstOrigin = firstPosition.toArray();
        const secondOrigin = secondPosition.toArray();
        const anchor = firstPosition.add(secondPosition).multiplyScalar(0.5).toArray();
        const firstRecord = fightRecords[closest.firstId];
        const secondRecord = fightRecords[closest.secondId];
        const winnerId = canDefeatEvolution(firstRecord, secondRecord)
          ? closest.firstId
          : closest.secondId;
        const loserId = winnerId === closest.firstId ? closest.secondId : closest.firstId;
        evolution.clearIntent(closest.firstId);
        evolution.clearIntent(closest.secondId);
        const firstEvent = interactions.triggerEvent(closest.firstId, {
          kind: 'fight',
          startedAt: now,
          duration: FIGHT_DURATION,
          targetId: closest.secondId,
          role: 'left',
          anchor,
          origin: firstOrigin
        });
        const secondEvent = interactions.triggerEvent(closest.secondId, {
          kind: 'fight',
          startedAt: now,
          duration: FIGHT_DURATION,
          targetId: closest.firstId,
          role: 'right',
          anchor,
          origin: secondOrigin
        });
        encounter.activeFight = {
          firstId: closest.firstId,
          secondId: closest.secondId,
          winnerId,
          loserId,
          resolveAt: now + FIGHT_DURATION,
          clearAt: now + FIGHT_DURATION + 1.9,
          resolved: false,
          firstSequence: firstEvent.sequence,
          secondSequence: secondEvent.sequence
        };
        encounter.creatureCooldowns.set(closest.firstId, now + 10);
        encounter.creatureCooldowns.set(closest.secondId, now + 10);
        encounter.pairCooldowns.set([closest.firstId, closest.secondId].sort().join('|'), now + 18);
      }
    }

    if (now < eventRef.current.nextAt) return;

    const latestEvents = useCreatureInteractionStore.getState().events;
    const mountedIds = Object.keys(mountedPositions);
    const visibleCreatures = mountedIds
      .map((id) => artwork.artworks.find((entry) => entry.id === id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(
        entry
        && !isSpotlightProtected(entry.id)
        && (behavior.featuredUntil[entry.id] ?? 0) <= wallTime
        && !latestEvents[entry.id]
      ));
    const step = eventRef.current.step % 5;
    eventRef.current.step += 1;
    eventRef.current.nextAt = now + randomDelay(EVENT_MIN_DELAY, EVENT_MAX_DELAY);

    if (step === 0) {
      behavior.addStarFood(randomWorldPoint());
      return;
    }

    if (step === 1) {
      behavior.addStarFood(randomWorldPoint());
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
    if (step === 3 && !useCreatureInteractionStore.getState().events[creature.id]) {
      interactions.triggerEvent(creature.id, {
        kind: 'boost',
        startedAt: now,
        duration: 1.45
      });
      encounter.creatureCooldowns.set(creature.id, now + 3);
      return;
    }
    // Particle disappearance is reserved for an explicit loss or a completed
    // planet capture. A generic ambient event must never make a model vanish.
    auto.triggerNebulaPulse(Math.floor(Math.random() * 3));
  });

  return null;
}
