import { create } from 'zustand';
import * as THREE from 'three';

export type StarFoodItem = {
  id: string;
  position: [number, number, number];
  createdAt: number;
};

type CreatureBehaviorState = {
  pointerWorld: [number, number, number] | null;
  foods: StarFoodItem[];
  creaturePositions: Record<string, [number, number, number]>;
  featuredUntil: Record<string, number>;
  setPointerWorld: (position: [number, number, number] | null) => void;
  addStarFood: (position: [number, number, number]) => void;
  removeStarFood: (id: string) => void;
  setCreaturePosition: (id: string, position: [number, number, number]) => void;
  setCreatureFeaturedUntil: (id: string, until: number) => void;
  removeCreaturePosition: (id: string) => void;
};

const CROWD_AVOIDANCE_RADIUS = 1.35;
const CROWD_AVOIDANCE_RADIUS_SQ = CROWD_AVOIDANCE_RADIUS * CROWD_AVOIDANCE_RADIUS;
const MAX_CROWD_NEIGHBORS = 4;
const creatureSpatialBuckets = new Map<string, Set<string>>();
const creatureCellById = new Map<string, string>();
const crowdDelta = new THREE.Vector3();

function spatialCoordinate(value: number) {
  return Math.floor(value / CROWD_AVOIDANCE_RADIUS);
}

function spatialKey(x: number, y: number, z: number) {
  return `${x}:${y}:${z}`;
}

function positionSpatialKey(position: [number, number, number]) {
  return spatialKey(
    spatialCoordinate(position[0]),
    spatialCoordinate(position[1]),
    spatialCoordinate(position[2])
  );
}

function removeFromSpatialBucket(id: string) {
  const previousKey = creatureCellById.get(id);
  if (!previousKey) return;
  const bucket = creatureSpatialBuckets.get(previousKey);
  bucket?.delete(id);
  if (bucket?.size === 0) creatureSpatialBuckets.delete(previousKey);
  creatureCellById.delete(id);
}

export const useCreatureBehaviorStore = create<CreatureBehaviorState>((set, get) => ({
  pointerWorld: null,
  foods: [],
  creaturePositions: {},
  featuredUntil: {},
  setPointerWorld: (position) => set({ pointerWorld: position }),
  addStarFood: (position) => set((state) => ({
    foods: [
      ...state.foods.slice(-7),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        position,
        createdAt: performance.now() * 0.001
      }
    ]
  })),
  removeStarFood: (id) => set((state) => ({
    foods: state.foods.filter((food) => food.id !== id)
  })),
  // Positions are frame-transient simulation data. Mutating this private map
  // avoids Zustand publishes and object copies on every rendered frame;
  // consumers intentionally read it through getState() inside useFrame.
  setCreaturePosition: (id, position) => {
    const nextKey = positionSpatialKey(position);
    const previousKey = creatureCellById.get(id);
    if (previousKey !== nextKey) {
      removeFromSpatialBucket(id);
      const bucket = creatureSpatialBuckets.get(nextKey) ?? new Set<string>();
      bucket.add(id);
      creatureSpatialBuckets.set(nextKey, bucket);
      creatureCellById.set(id, nextKey);
    }
    get().creaturePositions[id] = position;
  },
  setCreatureFeaturedUntil: (id, until) => {
    get().featuredUntil[id] = until;
  },
  removeCreaturePosition: (id) => {
    removeFromSpatialBucket(id);
    delete get().creaturePositions[id];
    delete get().featuredUntil[id];
  }
}));

export function nearestFoodAttraction(from: THREE.Vector3, now: number) {
  const foods = useCreatureBehaviorStore.getState().foods;
  const attraction = new THREE.Vector3();
  let nearestId: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const food of foods) {
    const age = now - food.createdAt;
    if (age > 18) {
      useCreatureBehaviorStore.getState().removeStarFood(food.id);
      continue;
    }

    const target = new THREE.Vector3(...food.position);
    const distance = from.distanceTo(target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = food.id;
      const strength = THREE.MathUtils.clamp(1 - distance / 4.2, 0, 1) * 0.72;
      attraction.copy(target.sub(from).normalize().multiplyScalar(strength));
    }
  }

  if (nearestId && nearestDistance < 0.32) {
    useCreatureBehaviorStore.getState().removeStarFood(nearestId);
  }

  return attraction;
}

export function pointerAvoidance(from: THREE.Vector3) {
  const pointer = useCreatureBehaviorStore.getState().pointerWorld;
  if (!pointer) return new THREE.Vector3();

  const pointerPosition = new THREE.Vector3(...pointer);
  const distance = from.distanceTo(pointerPosition);
  if (distance > 1.15) return new THREE.Vector3();

  const strength = (1 - distance / 1.15) * 0.42;
  return from.clone().sub(pointerPosition).normalize().multiplyScalar(strength);
}

export function crowdAvoidance(id: string, from: THREE.Vector3) {
  const positions = useCreatureBehaviorStore.getState().creaturePositions;
  const avoidance = new THREE.Vector3();
  let neighbors = 0;

  const cellX = spatialCoordinate(from.x);
  const cellY = spatialCoordinate(from.y);
  const cellZ = spatialCoordinate(from.z);
  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        const bucket = creatureSpatialBuckets.get(spatialKey(
          cellX + offsetX,
          cellY + offsetY,
          cellZ + offsetZ
        ));
        if (!bucket) continue;

        for (const otherId of bucket) {
          if (otherId === id) continue;
          const position = positions[otherId];
          if (!position) continue;
          crowdDelta.set(from.x - position[0], from.y - position[1], from.z - position[2]);
          const distanceSq = crowdDelta.lengthSq();
          if (distanceSq <= 0.000001 || distanceSq > CROWD_AVOIDANCE_RADIUS_SQ) continue;

          const distance = Math.sqrt(distanceSq);
          const strength = (1 - distance / CROWD_AVOIDANCE_RADIUS) * 0.22;
          avoidance.addScaledVector(crowdDelta, strength / distance);
          neighbors += 1;
          if (neighbors >= MAX_CROWD_NEIGHBORS) return avoidance;
        }
      }
    }
  }

  return avoidance;
}
