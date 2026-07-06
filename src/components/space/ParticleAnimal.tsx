import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

type AnimalKind = 'rabbit' | 'cat' | 'elephant';

type ParticleAnimalProps = {
  kind: AnimalKind;
  position: [number, number, number];
  scale: number;
  color: string;
  accent: string;
  phase: number;
};

type ShapePart = {
  center: [number, number];
  radius: [number, number];
  amount: number;
};

const SHAPES: Record<AnimalKind, ShapePart[]> = {
  rabbit: [
    { center: [0, 0], radius: [0.72, 0.34], amount: 520 },
    { center: [0.56, 0.28], radius: [0.28, 0.23], amount: 180 },
    { center: [0.5, 0.78], radius: [0.08, 0.42], amount: 140 },
    { center: [0.74, 0.78], radius: [0.08, 0.38], amount: 130 },
    { center: [-0.6, 0.1], radius: [0.14, 0.13], amount: 90 },
    { center: [-0.12, -0.35], radius: [0.16, 0.08], amount: 70 },
    { center: [0.5, -0.34], radius: [0.15, 0.08], amount: 65 }
  ],
  cat: [
    { center: [0, 0], radius: [0.58, 0.28], amount: 480 },
    { center: [0.46, 0.28], radius: [0.25, 0.22], amount: 180 },
    { center: [0.35, 0.55], radius: [0.12, 0.22], amount: 80 },
    { center: [0.6, 0.55], radius: [0.12, 0.22], amount: 80 },
    { center: [-0.72, 0.16], radius: [0.36, 0.06], amount: 130 },
    { center: [-0.18, -0.3], radius: [0.14, 0.07], amount: 60 },
    { center: [0.36, -0.3], radius: [0.14, 0.07], amount: 60 }
  ],
  elephant: [
    { center: [0, 0], radius: [0.7, 0.34], amount: 560 },
    { center: [0.58, 0.18], radius: [0.33, 0.28], amount: 230 },
    { center: [0.8, 0.18], radius: [0.1, 0.46], amount: 140 },
    { center: [0.34, 0.26], radius: [0.22, 0.28], amount: 130 },
    { center: [0.1, -0.38], radius: [0.1, 0.2], amount: 80 },
    { center: [-0.34, -0.38], radius: [0.1, 0.2], amount: 80 },
    { center: [-0.68, 0.06], radius: [0.16, 0.12], amount: 90 }
  ]
};

export function ParticleAnimal({ kind, position, scale, color, accent, phase }: ParticleAnimalProps) {
  const groupRef = useRef<THREE.Group>(null);
  const animal = useMemo(() => createAnimal(kind, color, accent), [accent, color, kind]);
  const trail = useMemo(() => createTrail(accent), [accent]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    animal.material.uniforms.uTime.value = time;
    trail.material.uniforms.uTime.value = time;

    if (!groupRef.current) return;
    const driftX = Math.sin(time * 0.18 + phase) * 0.22;
    const driftY = Math.cos(time * 0.14 + phase * 1.3) * 0.16;
    const driftZ = Math.sin(time * 0.11 + phase) * 0.16;
    groupRef.current.position.set(position[0] + driftX, position[1] + driftY, position[2] + driftZ);
    groupRef.current.rotation.z = Math.sin(time * 0.18 + phase) * 0.12;
    groupRef.current.rotation.y = Math.sin(time * 0.12 + phase) * 0.16;
  });

  return (
    <group ref={groupRef} position={position} scale={scale}>
      <points geometry={trail.geometry} material={trail.material} frustumCulled={false} raycast={() => null} />
      <points geometry={animal.geometry} material={animal.material} frustumCulled={false} raycast={() => null} />
    </group>
  );
}

function createAnimal(kind: AnimalKind, color: string, accent: string) {
  const parts = SHAPES[kind];
  const count = parts.reduce((sum, part) => sum + part.amount, 0);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const base = new THREE.Color(color);
  const glow = new THREE.Color(accent);
  let cursor = 0;

  for (const part of parts) {
    for (let i = 0; i < part.amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      const x = part.center[0] + Math.cos(angle) * r * part.radius[0];
      const y = part.center[1] + Math.sin(angle) * r * part.radius[1];
      const edge = Math.abs(r - 0.88) < 0.1;
      const colorMix = base.clone().lerp(glow, edge ? 0.5 : Math.random() * 0.28);
      const i3 = cursor * 3;

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = THREE.MathUtils.randFloatSpread(0.14);
      colors[i3] = colorMix.r;
      colors[i3 + 1] = colorMix.g;
      colors[i3 + 2] = colorMix.b;
      sizes[cursor] = THREE.MathUtils.randFloat(0.035, 0.08);
      phases[cursor] = Math.random() * Math.PI * 2;
      cursor += 1;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.z += sin(uTime * 1.1 + aPhase) * 0.015;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * 680.0 / max(-mvPosition.z, 0.01);
        vColor = color;
        vAlpha = 0.72 + sin(uTime * 1.4 + aPhase) * 0.18;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });

  return { geometry, material };
}

function createTrail(accent: string) {
  const count = 360;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const i3 = i * 3;
    positions[i3] = -0.42 - t * 2.35 + Math.sin(t * Math.PI * 4) * 0.08;
    positions[i3 + 1] = Math.sin(t * Math.PI * 2.4) * 0.13 + THREE.MathUtils.randFloatSpread(0.04);
    positions[i3 + 2] = THREE.MathUtils.randFloatSpread(0.1);
    sizes[i] = THREE.MathUtils.lerp(0.06, 0.015, t);
    alphas[i] = (1 - t) * THREE.MathUtils.randFloat(0.22, 0.72);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(accent) }
    },
    vertexShader: `
      uniform float uTime;
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.7 + position.x * 2.6) * 0.035;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * 620.0 / max(-mvPosition.z, 0.01);
        vAlpha = aAlpha;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(uColor, alpha);
      }
    `
  });

  return { geometry, material };
}
