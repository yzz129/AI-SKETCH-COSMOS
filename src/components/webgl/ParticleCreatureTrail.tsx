import { useFrame } from '@react-three/fiber';
import { MutableRefObject, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ArtworkParticle } from '../../utils/artworkImage';

type ParticleCreatureTrailProps = {
  particles: ArtworkParticle[];
  seed: number;
  intensity: number;
  spotlightFocusRef?: MutableRefObject<number>;
};

export function ParticleCreatureTrail({ particles, seed, intensity, spotlightFocusRef }: ParticleCreatureTrailProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const count = Math.round(150 + intensity * 210);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const alphas = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      const t = i / Math.max(count - 1, 1);
      const source = particles[Math.floor((t * 997 + seed * 23) % Math.max(particles.length, 1))];
      const spread = 0.035 + t * (0.24 + intensity * 0.2);
      const arc = Math.sin(t * Math.PI) * 0.12 * intensity;

      positions[i3] = -0.18 - t * (0.95 + intensity * 0.72) + THREE.MathUtils.randFloatSpread(spread);
      positions[i3 + 1] = Math.sin(t * 5.2 + seed) * arc + THREE.MathUtils.randFloatSpread(spread * 0.86);
      positions[i3 + 2] = -0.08 - t * (0.34 + intensity * 0.18) + THREE.MathUtils.randFloatSpread(0.14 + t * 0.12);
      colors[i3] = source ? source.r / 255 : 0.7;
      colors[i3 + 1] = source ? source.g / 255 : 0.82;
      colors[i3 + 2] = source ? source.b / 255 : 1;
      sizes[i] = 0.008 + (1 - t) * 0.01 + Math.random() * 0.01;
      phases[i] = Math.random() * Math.PI * 2;
      alphas[i] = Math.pow(1 - t, 1.45) * (0.12 + intensity * 0.12);
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    bufferGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    bufferGeometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    bufferGeometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    return bufferGeometry;
  }, [intensity, particles, seed]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uFocusAmount: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uFocusAmount;
      attribute vec3 color;
      attribute float size;
      attribute float phase;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        p.y += sin(uTime * 1.55 + phase + p.x * 2.0) * 0.028;
        p.z += cos(uTime * 1.12 + phase + p.x) * 0.026;
        p.x += sin(uTime * 0.82 + phase) * 0.016;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * 118.0 * uPixelRatio * (1.0 / max(-mvPosition.z, 0.01));
        vColor = color;
        vAlpha = alpha * 0.78 * (1.0 - smoothstep(0.08, 0.86, uFocusAmount));
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float alpha = smoothstep(0.5, 0.0, length(center)) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  }), []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uFocusAmount.value = spotlightFocusRef?.current ?? 0;
    material.visible = (spotlightFocusRef?.current ?? 0) < 0.98;
    if (!pointsRef.current) return;
    pointsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.6 + seed) * 0.04;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} renderOrder={9} frustumCulled={false} />;
}
