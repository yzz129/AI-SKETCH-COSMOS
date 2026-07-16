import { useFrame } from '@react-three/fiber';
import { type MutableRefObject, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCreatureInteractionStore } from './creatureInteractionStore';

type CreatureDustFeedingProps = {
  creatureId: string;
  seed: number;
  renderOrderRef?: MutableRefObject<number>;
  reappearRef?: MutableRefObject<number>;
};

const DUST_COUNT = 22;

function seeded(seed: number, index: number, salt: number) {
  const value = Math.sin(seed * 13.17 + index * 91.73 + salt * 37.11) * 43758.5453;
  return value - Math.floor(value);
}

export function CreatureDustFeeding({
  creatureId,
  seed,
  renderOrderRef,
  reappearRef
}: CreatureDustFeedingProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const positions = new Float32Array(DUST_COUNT * 3);
    const phases = new Float32Array(DUST_COUNT);
    const colors = new Float32Array(DUST_COUNT * 3);
    const color = new THREE.Color();
    for (let index = 0; index < DUST_COUNT; index += 1) {
      const theta = seeded(seed, index, 1) * Math.PI * 2;
      const z = seeded(seed, index, 2) * 2 - 1;
      const radius = Math.sqrt(Math.max(0, 1 - z * z));
      const i3 = index * 3;
      positions[i3] = Math.cos(theta) * radius;
      positions[i3 + 1] = Math.sin(theta) * radius;
      positions[i3 + 2] = z;
      phases[index] = seeded(seed, index, 3);
      color.set(index % 3 === 0 ? '#d987ff' : index % 2 === 0 ? '#70e5ff' : '#8ca8ff');
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }
    const output = new THREE.BufferGeometry();
    output.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    output.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    output.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return output;
  }, [seed]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uPixelRatio;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float progress = fract(uTime * 0.16 + aPhase);
        float radius = mix(0.92, 0.08, progress * progress);
        float spiral = progress * 8.0 + aPhase * 6.28318530718;
        vec3 direction = normalize(position + vec3(0.0001));
        vec3 p = direction * radius;
        p.x += cos(spiral) * radius * 0.14;
        p.y += sin(spiral) * radius * 0.14;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = mix(2.4, 1.1, progress) * uPixelRatio;
        vColor = color;
        vAlpha = sin(progress * 3.14159265359) * uOpacity;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        if (distanceToCenter > 0.5) discard;
        float alpha = smoothstep(0.5, 0.08, distanceToCenter) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  }), []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const interaction = useCreatureInteractionStore.getState().events[creatureId];
    const feedingWindow = THREE.MathUtils.smoothstep(
      Math.sin(clock.elapsedTime * 0.46 + seed) * 0.5 + 0.5,
      0.42,
      0.72
    );
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uOpacity.value = interaction
      ? 0
      : feedingWindow * (reappearRef?.current ?? 1) * 0.34;
    material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
    points.renderOrder = (renderOrderRef?.current ?? 10) + 4;
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
    />
  );
}
