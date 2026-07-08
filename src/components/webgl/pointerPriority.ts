import * as THREE from 'three';

const CREATURE_PRIORITY_HIT_KEY = 'cosmicCreaturePriorityHit';

type RayIntersectionLike = {
  object: THREE.Object3D;
};

type PointerEventLike = {
  intersections?: RayIntersectionLike[];
};

export function markCreaturePriorityHit(userData?: Record<string, unknown>) {
  return {
    ...userData,
    [CREATURE_PRIORITY_HIT_KEY]: true
  };
}

export function hasCreaturePriorityHit(event: PointerEventLike) {
  return Boolean(event.intersections?.some((intersection) => {
    let object: THREE.Object3D | null = intersection.object;
    while (object) {
      if (object.userData?.[CREATURE_PRIORITY_HIT_KEY]) return true;
      object = object.parent;
    }
    return false;
  }));
}
