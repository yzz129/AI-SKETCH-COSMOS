import * as THREE from 'three';

export const DADAKIDO_WORLD_POSITION = [0, 0, -8.85] as const;

export const CREATURE_ORBIT_CENTER = new THREE.Vector3(
  DADAKIDO_WORLD_POSITION[0],
  DADAKIDO_WORLD_POSITION[1],
  DADAKIDO_WORLD_POSITION[2]
);

export const CAMERA_ORBIT_TARGET = new THREE.Vector3(
  DADAKIDO_WORLD_POSITION[0],
  DADAKIDO_WORLD_POSITION[1] + 0.05,
  DADAKIDO_WORLD_POSITION[2]
);

export const POINTER_INTERACTION_PLANE_Z = DADAKIDO_WORLD_POSITION[2] + 0.9;

export const EXHIBITION_CREATURE_ORBIT = {
  radiusX: 7.15,
  radiusY: 2.28,
  radiusZ: 4.1,
  pointerWidth: 30,
  pointerHeight: 18
} as const;
