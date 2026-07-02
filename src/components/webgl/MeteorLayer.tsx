import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

type Meteor = {
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: THREE.Vector3;
  duration: number;
  delay: number;
  length: number;
  width: number;
};

function createMeteorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 16, 256, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.2, 'rgba(94,164,255,.08)');
  gradient.addColorStop(0.46, 'rgba(132,198,255,.28)');
  gradient.addColorStop(0.78, 'rgba(255,218,255,.72)');
  gradient.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 32);
  const head = ctx.createRadialGradient(235, 16, 1, 235, 16, 25);
  head.addColorStop(0, 'rgba(255,255,255,1)');
  head.addColorStop(0.22, 'rgba(190,225,255,.92)');
  head.addColorStop(0.55, 'rgba(170,124,255,.38)');
  head.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = head;
  ctx.fillRect(208, -12, 56, 56);
  ctx.strokeStyle = 'rgba(255,255,255,.72)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(218, 16);
  ctx.lineTo(255, 16);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function MeteorLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const texture = useMemo(createMeteorTexture, []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    opacity: 0.42
  }), [texture]);
  const meteors = useMemo<Meteor[]>(() => [
    {
      start: new THREE.Vector3(-5.8, 3.1, -6.2),
      velocity: new THREE.Vector3(2.5, -1.62, -0.04),
      gravity: new THREE.Vector3(0.03, -0.08, 0),
      duration: 2.8,
      delay: 0.6,
      length: 1.35,
      width: 0.017
    },
    {
      start: new THREE.Vector3(5.6, 2.55, -7.8),
      velocity: new THREE.Vector3(-2.1, -1.38, 0.03),
      gravity: new THREE.Vector3(-0.02, -0.07, 0),
      duration: 3.1,
      delay: 4.9,
      length: 1.15,
      width: 0.015
    },
    {
      start: new THREE.Vector3(-1.2, 3.4, -8.4),
      velocity: new THREE.Vector3(1.65, -1.85, -0.02),
      gravity: new THREE.Vector3(0.02, -0.06, 0),
      duration: 2.7,
      delay: 8.4,
      length: 1,
      width: 0.014
    },
    {
      start: new THREE.Vector3(4.4, -0.35, -6.8),
      velocity: new THREE.Vector3(-1.9, -1.15, 0.02),
      gravity: new THREE.Vector3(-0.02, -0.05, 0),
      duration: 2.9,
      delay: 12.2,
      length: 1.25,
      width: 0.016
    }
  ], []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const headPosition = useMemo(() => new THREE.Vector3(), []);
  const centerPosition = useMemo(() => new THREE.Vector3(), []);
  const velocity = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const time = clock.elapsedTime;

    meteors.forEach((meteor, index) => {
      const loopTime = (time + meteor.delay) % (meteor.duration + 8.6);
      const activeTime = Math.min(loopTime, meteor.duration);
      const progress = activeTime / meteor.duration;
      const isActive = loopTime <= meteor.duration ? 1 : 0;
      const fadeIn = THREE.MathUtils.smoothstep(progress, 0.02, 0.16);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.7, 1.0);
      const fade = fadeIn * fadeOut;

      headPosition.copy(meteor.start)
        .addScaledVector(meteor.velocity, activeTime)
        .addScaledVector(meteor.gravity, 0.5 * activeTime * activeTime);
      velocity.copy(meteor.velocity).addScaledVector(meteor.gravity, activeTime);
      direction.copy(velocity).normalize();
      const visibleLength = meteor.length * (0.68 + progress * 0.35) * fade * isActive;
      const visibleWidth = meteor.width * (0.45 + fade * 0.7) * isActive;

      centerPosition.copy(headPosition).addScaledVector(direction, -visibleLength * 0.5);
      quaternion.setFromEuler(new THREE.Euler(0, 0, Math.atan2(direction.y, direction.x)));
      scale.set(visibleLength, visibleWidth, 1);
      matrix.compose(centerPosition, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, meteors.length]} renderOrder={5} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}
