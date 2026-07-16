import * as THREE from 'three';

export type GalaxyPortal = {
  id: string;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  velocity: THREE.Vector3;
  captureRadius: number;
  apertureRadius: number;
  visualRadius: number;
};

const portals = new Map<string, GalaxyPortal>();

export function updateGalaxyPortal(
  id: string,
  position: THREE.Vector3,
  normal: THREE.Vector3,
  velocity: THREE.Vector3,
  captureRadius: number,
  apertureRadius: number,
  visualRadius: number
) {
  const existing = portals.get(id);
  if (existing) {
    existing.position.copy(position);
    existing.normal.copy(normal);
    existing.velocity.copy(velocity);
    existing.captureRadius = captureRadius;
    existing.apertureRadius = apertureRadius;
    existing.visualRadius = visualRadius;
    return;
  }
  portals.set(id, {
    id,
    position: position.clone(),
    normal: normal.clone(),
    velocity: velocity.clone(),
    captureRadius,
    apertureRadius,
    visualRadius
  });
}

export function removeGalaxyPortal(id: string) {
  portals.delete(id);
}

export function getGalaxyPortal(id: string) {
  return portals.get(id);
}

export function getSortedGalaxyPortals() {
  return [...portals.values()].sort((left, right) => left.id.localeCompare(right.id));
}
