import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

type CloudAnchor = {
  x: number;
  y: number;
  z: [number, number];
  sx: number;
  sy: number;
  density: number;
  color: string;
};

const CLOUDS: CloudAnchor[] = [
  { x: -5.55, y: -3.02, z: [-6.8, -3.8], sx: 3.05, sy: 1.16, density: 1200, color: '#01030a' },
  { x: 4.72, y: -2.55, z: [-7.4, -3.6], sx: 3.55, sy: 1.62, density: 1700, color: '#061022' },
  { x: 6.12, y: 0.68, z: [-8.2, -4.0], sx: 1.36, sy: 3.28, density: 1100, color: '#120b2f' },
  { x: 0.45, y: -3.35, z: [-7.4, -4.0], sx: 5.5, sy: 0.8, density: 1000, color: '#120b2f' },
  { x: 3.2, y: -1.55, z: [-8.0, -5.0], sx: 1.95, sy: 1.05, density: 700, color: '#020611' }
];

export function DarkNebulaClouds() {
  const pointsRef = useRef<THREE.Points>(null);
  const { geometry, material } = useMemo(() => {
    const count = CLOUDS.reduce((sum, cloud) => sum + cloud.density, 0);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const phases = new Float32Array(count);
    let cursor = 0;

    for (const cloud of CLOUDS) {
      const base = new THREE.Color(cloud.color);
      const rim = new THREE.Color('#3a2a8c');
      for (let i = 0; i < cloud.density; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.pow(Math.random(), 0.36);
        const i3 = cursor * 3;
        const color = base.clone().lerp(rim, Math.random() * 0.16);

        positions[i3] = cloud.x + Math.cos(angle) * radius * cloud.sx + THREE.MathUtils.randFloatSpread(0.24);
        positions[i3 + 1] = cloud.y + Math.sin(angle) * radius * cloud.sy + THREE.MathUtils.randFloatSpread(0.18);
        positions[i3 + 2] = THREE.MathUtils.randFloat(cloud.z[0], cloud.z[1]);
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;
        sizes[cursor] = THREE.MathUtils.randFloat(0.05, 0.16) * (1.18 - radius * 0.32);
        alphas[cursor] = THREE.MathUtils.randFloat(0.12, 0.28) * (1 - radius * 0.46);
        phases[cursor] = Math.random() * Math.PI * 2;
        cursor += 1;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      vertexColors: true,
      toneMapped: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec3 p = position;
          p.xy += vec2(sin(uTime * 0.052 + aPhase), cos(uTime * 0.046 + aPhase)) * 0.11;
          p.z += sin(uTime * 0.035 + aPhase) * 0.1;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * 620.0 * uPixelRatio / max(-mvPosition.z, 0.01);
          vColor = color;
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float alpha = pow(smoothstep(0.5, 0.0, d), 1.35) * vAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `
    });

    return { geometry, material };
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    if (pointsRef.current) {
      const time = clock.elapsedTime;
      pointsRef.current.rotation.z = Math.sin(time * 0.035) * 0.028;
      pointsRef.current.rotation.x = Math.sin(time * 0.026) * 0.018;
      pointsRef.current.rotation.y = Math.cos(time * 0.022) * 0.022;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} renderOrder={4} frustumCulled={false} raycast={() => null} />;
}
