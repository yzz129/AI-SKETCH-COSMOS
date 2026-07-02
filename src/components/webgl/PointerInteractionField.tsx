import { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useCreatureBehaviorStore } from '../../utils/creatureBehavior';

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
      THREE.MathUtils.randFloat(-1.35, 0.85)
    ]);
  };

  return (
    <mesh
      position={[0, 0, 0.2]}
      material={material}
      onPointerMove={updatePointer}
      onPointerOut={() => useCreatureBehaviorStore.getState().setPointerWorld(null)}
      onPointerDown={addFood}
      renderOrder={-10}
    >
      <planeGeometry args={[18, 10]} />
    </mesh>
  );
}
