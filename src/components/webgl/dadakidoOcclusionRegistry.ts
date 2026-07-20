import * as THREE from 'three';

export const MAX_DADAKIDO_OCCLUDERS = 16;

export type DadakidoOccluder = {
  position: THREE.Vector3;
  radiusX: number;
  radiusY: number;
  strength: number;
  visibility: number;
};

const occluders = new Map<string, DadakidoOccluder>();

export function updateDadakidoOccluder(
  id: string,
  position: THREE.Vector3,
  radiusX: number,
  radiusY: number,
  strength: number,
  visibility = strength
) {
  if (visibility <= 0.001) {
    occluders.delete(id);
    return;
  }
  const clampedStrength = THREE.MathUtils.clamp(strength, 0, 1);
  const clampedVisibility = THREE.MathUtils.clamp(visibility, 0, 1);
  const existing = occluders.get(id);
  if (existing) {
    existing.position.copy(position);
    existing.radiusX = radiusX;
    existing.radiusY = radiusY;
    existing.strength = clampedStrength;
    existing.visibility = clampedVisibility;
    return;
  }
  occluders.set(id, {
    position: position.clone(),
    radiusX,
    radiusY,
    strength: clampedStrength,
    visibility: clampedVisibility
  });
}

export function removeDadakidoOccluder(id: string) {
  occluders.delete(id);
}

export function getDadakidoOccluders() {
  return occluders.values();
}
