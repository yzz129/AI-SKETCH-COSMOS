import { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';
import { DADAKIDO_WORLD_POSITION, EXHIBITION_CREATURE_ORBIT, POINTER_INTERACTION_PLANE_Z } from './cosmicAnchors';

const pointerPosition = new THREE.Vector3();

export function PointerInteractionField() {
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  }), []);

  const updatePointer = (event: ThreeEvent<PointerEvent>) => {
    pointerPosition.copy(event.point);
    useCreatureBehaviorStore.getState().setPointerWorld([
      pointerPosition.x,
      pointerPosition.y,
      pointerPosition.z
    ]);
  };

  const addFood = (event: ThreeEvent<PointerEvent>) => {
    updatePointer(event);
    useCreatureBehaviorStore.getState().addStarFood([
      event.point.x,
      event.point.y,
      DADAKIDO_WORLD_POSITION[2] + THREE.MathUtils.randFloat(
        -EXHIBITION_CREATURE_ORBIT.radiusZ,
        EXHIBITION_CREATURE_ORBIT.radiusZ
      )
    ]);
  };

  return (
    <mesh
      position={[0, 0, POINTER_INTERACTION_PLANE_Z]}
      material={material}
      onPointerMove={updatePointer}
      onPointerOut={() => useCreatureBehaviorStore.getState().setPointerWorld(null)}
      onPointerDown={addFood}
      renderOrder={-10}
    >
      <planeGeometry args={[EXHIBITION_CREATURE_ORBIT.pointerWidth, EXHIBITION_CREATURE_ORBIT.pointerHeight]} />
    </mesh>
  );
}
