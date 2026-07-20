import * as THREE from 'three';

export const MAX_ACTIVE_CREATURES = 20;
export const CREATURE_BUBBLE_ROTATION_MS = 5_000;

const activeCreatureIds = new Set<string>();
let initialCreatureAdmissionSettled = false;

export function replaceActiveCreatureIds(ids: Iterable<string>) {
  activeCreatureIds.clear();
  for (const id of ids) activeCreatureIds.add(id);
}

export function isCreatureActivityActive(id: string) {
  return activeCreatureIds.has(id);
}

export function setInitialCreatureAdmissionSettled(settled: boolean) {
  initialCreatureAdmissionSettled = settled;
}

export function isInitialCreatureAdmissionSettled() {
  return initialCreatureAdmissionSettled;
}

export function selectBubbledCreatureIds(
  orderedIds: string[],
  rotationOffset: number,
  protectedActiveIds: Array<string | null>
) {
  const bubbleCount = Math.max(0, orderedIds.length - MAX_ACTIVE_CREATURES);
  if (bubbleCount === 0) return [];

  const availableIds = new Set(orderedIds);
  const protectedIds = new Set<string>();
  for (const id of protectedActiveIds) {
    if (id && availableIds.has(id)) protectedIds.add(id);
  }
  const bubbledIds: string[] = [];
  for (let cursor = 0; cursor < orderedIds.length && bubbledIds.length < bubbleCount; cursor += 1) {
    const id = orderedIds[(rotationOffset + cursor) % orderedIds.length];
    if (!protectedIds.has(id)) bubbledIds.push(id);
  }
  return bubbledIds;
}

export type CreatureBubbleScreenAnchor = {
  x: number;
  y: number;
  depth: number;
  pointSize?: number;
};

const R2_X = 0.7548776662466927;
const R2_Y = 0.5698402909980532;

export function getCreatureBubbleDensityScale(bubbleCount: number) {
  if (bubbleCount <= 72) return 1;
  return THREE.MathUtils.clamp(Math.sqrt(72 / Math.max(1, bubbleCount)), 0.2, 1);
}

export function getCreatureCrowdScale(totalCount: number) {
  if (totalCount <= 30) return 1;
  return THREE.MathUtils.clamp(Math.sqrt(36 / Math.max(1, totalCount)), 0.32, 1);
}

export function getCreatureBubbleScreenAnchor(
  bubbleIndex: number,
  _bubbleCount: number
): CreatureBubbleScreenAnchor {
  const safeIndex = Math.max(0, Math.floor(bubbleIndex));
  // R2 low-discrepancy placement is stable as more creatures arrive: existing
  // slots never move, while new slots fill the largest remaining screen gaps.
  const u = (0.5 + (safeIndex + 1) * R2_X) % 1;
  const v = (0.5 + (safeIndex + 1) * R2_Y) % 1;

  let x = (u * 2 - 1) * 0.98;
  let y = (v * 2 - 1) * 0.94;

  // Keep a calm focal pocket around the central title. Slots inside this
  // ellipse are pushed to its rim without changing the stable R2 ordering.
  const focalRadiusX = 0.42;
  const focalRadiusY = 0.15;
  const focalX = x / focalRadiusX;
  const focalY = y / focalRadiusY;
  const focalDistance = Math.hypot(focalX, focalY);
  if (focalDistance < 1) {
    const angle = focalDistance > 0.001
      ? Math.atan2(focalY, focalX)
      : safeIndex * Math.PI * (3 - Math.sqrt(5));
    x = Math.cos(angle) * focalRadiusX * 1.08;
    y = Math.sin(angle) * focalRadiusY * 1.08;
  }

  return {
    x,
    y,
    depth: 24
  };
}

export function writeCreatureBubbleWorldPosition(
  camera: THREE.Camera,
  anchor: CreatureBubbleScreenAnchor,
  target: THREE.Vector3,
  forward: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3
) {
  camera.getWorldDirection(forward);

  if (camera instanceof THREE.PerspectiveCamera) {
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * anchor.depth / camera.zoom;
    const halfWidth = halfHeight * camera.aspect;
    return target
      .copy(camera.position)
      .addScaledVector(forward, anchor.depth)
      .addScaledVector(right, anchor.x * halfWidth)
      .addScaledVector(up, anchor.y * halfHeight);
  }

  return target.set(anchor.x, anchor.y, 0.7).unproject(camera);
}
